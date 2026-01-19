import { ToolLoopAgent, stepCountIs } from 'ai';
import { convertToAISDKTool } from '../tool/utils';
import { AgentConfig, AgentMessage, AgentResponse } from './agent';
import { AIProvider } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { createHandoffTool, HandoffResult } from '../tool/handoff';
import { loadPromptFile } from '../../utils/prompt-loader';
import { MCPClientImpl, createAISDKToolsFromMCP, convertMCPToolsToFredTools } from '../mcp';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { setActiveSpan } from '../tracing/context';

/**
 * Get a safe error message for tool execution failures
 * This prevents leaking internal error details to the model
 */
function getSafeToolErrorMessage(toolId: string, error: unknown): string {
  // Log the actual error for debugging (server-side only)
  console.error(`Tool execution failed for "${toolId}":`, error);
  
  // Return a generic, safe error message that doesn't expose internal details
  return `Tool "${toolId}" execution failed. Please try again or use a different approach.`;
}

/**
 * MCP client connection metrics
 * Note: connectionsByAgent is returned as a plain object (not a Map) for JSON serialization
 */
export interface MCPClientMetrics {
  totalConnections: number;
  activeConnections: number;
  failedConnections: number;
  closedConnections: number;
  connectionsByAgent: Record<string, number>; // Plain object for JSON serialization
  lastConnectionTime?: Date;
  lastDisconnectionTime?: Date;
}

export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map(); // Track MCP clients per agent
  private tracer?: Tracer;
  private metrics: MCPClientMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    failedConnections: 0,
    closedConnections: 0,
    connectionsByAgent: new Map(),
  };
  private shutdownHooksRegistered = false;

  constructor(toolRegistry: ToolRegistry, tracer?: Tracer) {
    this.toolRegistry = toolRegistry;
    this.tracer = tracer;
  }

  /**
   * Set the tracer for agent creation
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Set handoff handler for agent-to-agent handoffs
   */
  setHandoffHandler(handler: { getAgent: (id: string) => any; getAvailableAgents: () => string[] }): void {
    this.handoffHandler = handler;
  }

  /**
   * Clean up MCP clients for a specific agent
   * This should be called when an agent is removed to prevent memory leaks
   */
  async cleanupMCPClients(agentId: string): Promise<void> {
    const keysToRemove: string[] = [];
    
    for (const [key, client] of this.mcpClients.entries()) {
      if (key.startsWith(`${agentId}-`)) {
        try {
          await client.close();
          this.metrics.closedConnections++;
        } catch (error) {
          console.error(`Error closing MCP client "${key}":`, error);
        }
        keysToRemove.push(key);
      }
    }
    
    // Remove closed clients from map
    for (const key of keysToRemove) {
      this.mcpClients.delete(key);
    }
    
    // Update metrics
    this.metrics.activeConnections = this.mcpClients.size;
    this.metrics.connectionsByAgent.delete(agentId);
    if (keysToRemove.length > 0) {
      this.metrics.lastDisconnectionTime = new Date();
    }
  }

  /**
   * Clean up all MCP clients
   * This should be called during shutdown to prevent resource leaks
   */
  async cleanupAllMCPClients(): Promise<void> {
    const clients = Array.from(this.mcpClients.values());
    const clientCount = clients.length;
    this.mcpClients.clear();
    // Also clear per-agent connection counts
    this.metrics.connectionsByAgent.clear();
    
    // Close all clients in parallel
    const results = await Promise.allSettled(
      clients.map(async (client) => {
        try {
          await client.close();
          this.metrics.closedConnections++;
        } catch (error) {
          console.error('Error closing MCP client:', error);
        }
      })
    );
    
    // Update metrics
    this.metrics.activeConnections = 0;
    this.metrics.lastDisconnectionTime = new Date();
    
    // Log cleanup summary
    const successful = results.filter(r => r.status === 'fulfilled').length;
    if (clientCount > 0) {
      console.log(`[AgentFactory] Cleaned up ${successful}/${clientCount} MCP clients`);
    }
  }

  /**
   * Get MCP client connection metrics
   */
  getMCPMetrics(): MCPClientMetrics {
    // Convert Map to a plain object for JSON-serializable telemetry/export
    const connectionsByAgentObj = Object.fromEntries(this.metrics.connectionsByAgent.entries());
    return {
      totalConnections: this.metrics.totalConnections,
      activeConnections: this.mcpClients.size,
      failedConnections: this.metrics.failedConnections,
      closedConnections: this.metrics.closedConnections,
      connectionsByAgent: connectionsByAgentObj, // Plain object for JSON serialization
      lastConnectionTime: this.metrics.lastConnectionTime,
      lastDisconnectionTime: this.metrics.lastDisconnectionTime,
    };
  }

  /**
   * Register shutdown hooks for cleanup
   * This should be called once during application initialization
   */
  registerShutdownHooks(): void {
    if (this.shutdownHooksRegistered) {
      return; // Already registered
    }
    
    this.shutdownHooksRegistered = true;
    
    // Register cleanup on process exit signals
    const cleanup = async () => {
      try {
        await this.cleanupAllMCPClients();
      } catch (error) {
        console.error('[AgentFactory] Error during shutdown cleanup:', error);
      }
    };
    
    // Handle graceful shutdown signals
    if (typeof process !== 'undefined') {
      process.on('SIGINT', async () => {
        await cleanup();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        await cleanup();
        process.exit(0);
      });
      
      // Handle uncaught exceptions and unhandled rejections
      process.on('beforeExit', async () => {
        await cleanup();
      });
    }
  }

  /**
   * Create an agent instance from configuration
   */
  async createAgent(
    config: AgentConfig,
    provider: AIProvider
  ): Promise<{
    processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
    streamMessage: (message: string, messages?: AgentMessage[]) => AsyncGenerator<{ textDelta: string; fullText: string; toolCalls?: any[] }, void, unknown>;
  }> {
    const model = provider.getModel(config.model);
    
    // Get tools for this agent
    const tools = config.tools ? this.toolRegistry.getTools(config.tools) : [];
    
    // Auto-register handoff tool if handler is available
    if (this.handoffHandler) {
      const handoffTool = createHandoffTool(
        this.handoffHandler.getAgent,
        this.handoffHandler.getAvailableAgents,
        this.tracer
      );
      tools.push(handoffTool);
    }
    
    // Initialize MCP servers and discover tools
    const mcpTools: Record<string, any> = {};
    const mcpClientInstances: MCPClientImpl[] = [];
    
    if (config.mcpServers && config.mcpServers.length > 0) {
      for (const mcpConfig of config.mcpServers) {
        // Skip disabled servers
        if (mcpConfig.enabled === false) {
          continue;
        }

        try {
          // Create and initialize MCP client
          const mcpClient = new MCPClientImpl(mcpConfig);
          await mcpClient.initialize();
          mcpClientInstances.push(mcpClient);
          
          // Store client for cleanup later
          const clientKey = `${config.id}-${mcpConfig.id}`;
          this.mcpClients.set(clientKey, mcpClient);
          
          // Update metrics
          this.metrics.totalConnections++;
          this.metrics.activeConnections = this.mcpClients.size;
          this.metrics.lastConnectionTime = new Date();
          const agentConnections = this.metrics.connectionsByAgent.get(config.id) || 0;
          this.metrics.connectionsByAgent.set(config.id, agentConnections + 1);
          
          // Discover tools from MCP server
          const discoveredTools = await mcpClient.listTools();
          
          // Convert MCP tools to AI SDK format
          const aiSdkTools = createAISDKToolsFromMCP(discoveredTools, mcpClient, mcpConfig.id);
          Object.assign(mcpTools, aiSdkTools);
          
          // Also register MCP tools in the tool registry (for consistency)
          const fredTools = convertMCPToolsToFredTools(discoveredTools, mcpClient, mcpConfig.id);
          for (const fredTool of fredTools) {
            // Only register if not already registered (avoid conflicts)
            if (!this.toolRegistry.hasTool(fredTool.id)) {
              this.toolRegistry.registerTool(fredTool);
            }
          }
        } catch (error) {
          // Update metrics for failed connection
          this.metrics.failedConnections++;
          // Log error but don't fail agent creation
          console.error(`Failed to initialize MCP server "${mcpConfig.id}":`, error);
          // Continue with other MCP servers
        }
      }
    }
    
    // Convert regular tools to AI SDK format with tracing and timeout
    const sdkTools: Record<string, any> = {};
    const toolTimeout = config.toolTimeout ?? 300000; // Default: 5 minutes
    
    for (const toolDef of tools) {
      // Wrap tool execution with tracing and timeout
      const originalExecute = toolDef.execute;
      const tracedExecute = async (args: any) => {
        const startTime = Date.now();
        const toolSpan = this.tracer?.startSpan('tool.execute', {
          kind: SpanKind.CLIENT,
          attributes: {
            'tool.id': toolDef.id,
            'tool.name': toolDef.name,
            'tool.args': JSON.stringify(args),
            'tool.timeout': toolTimeout,
          },
        });

        const previousActiveSpan = this.tracer?.getActiveSpan();
        if (toolSpan) {
          this.tracer?.setActiveSpan(toolSpan);
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        
        try {
          // Execute tool with timeout and ensure timer cleanup to avoid event loop handle leaks
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              const timeoutError = new Error(`Tool "${toolDef.id}" execution timed out after ${toolTimeout}ms`);
              timeoutError.name = 'ToolTimeoutError';
              reject(timeoutError);
            }, toolTimeout);
          });

          // Race between tool execution and timeout
          const result = await Promise.race([
            originalExecute(args),
            timeoutPromise,
          ]);
          
          // Clear timeout if execution completed successfully
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          
          const executionTime = Date.now() - startTime;
          
          if (toolSpan) {
            toolSpan.setAttributes({
              'tool.result.type': typeof result,
              'tool.result.hasValue': result !== undefined && result !== null,
              'tool.executionTime': executionTime,
            });
            // Don't log full result if it's too large (could be sensitive data)
            if (typeof result === 'string' && result.length < 1000) {
              toolSpan.setAttribute('tool.result.preview', result.substring(0, 100));
            }
            toolSpan.setStatus('ok');
          }
          
          return result;
        } catch (error) {
          // Clear timeout on error (whether timeout or execution error)
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          
          const executionTime = Date.now() - startTime;
          
          if (toolSpan) {
            toolSpan.setAttribute('tool.executionTime', executionTime);
            if (error instanceof Error) {
              toolSpan.recordException(error);
              const isTimeout = error.name === 'ToolTimeoutError';
              toolSpan.setAttribute('tool.timedOut', isTimeout);
              toolSpan.setStatus('error', error.message);
            } else {
              toolSpan.setStatus('error', 'Unknown error');
            }
          }
          
          // Return safe error message for timeouts to prevent leaking internal details
          if (error instanceof Error && error.name === 'ToolTimeoutError') {
            // Log the actual error for debugging
            console.error(`Tool execution timed out for "${toolDef.id}" after ${toolTimeout}ms`);
            // Return a safe error message
            throw new Error(`Tool "${toolDef.id}" execution timed out. Please try again or use a different approach.`);
          }
          
          throw error;
        } finally {
          // Ensure timeout is always cleared to prevent memory leaks
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          if (toolSpan) {
            toolSpan.end();
            // Restore previous active span
            if (previousActiveSpan) {
              this.tracer?.setActiveSpan(previousActiveSpan);
            } else {
              this.tracer?.setActiveSpan(undefined);
            }
          }
        }
      };

      // Convert tool to AI SDK format using shared utility
      // The utility handles schema normalization, Groq compatibility, and AI SDK v6 conversion
      sdkTools[toolDef.id] = convertToAISDKTool(
        toolDef,
        tracedExecute as (args: Record<string, any>) => Promise<any>
      );
    }
    
    // Merge MCP tools with regular tools
    Object.assign(sdkTools, mcpTools);

    // Load system message (handle file paths for programmatic usage)
    // Note: When loaded from config, paths are already resolved in extractAgents
    // For programmatic usage, sandbox to current working directory and disallow absolute paths
    const systemMessage = loadPromptFile(config.systemMessage, undefined, false);

    // Create ToolLoopAgent instance
    const agent = new ToolLoopAgent({
      model,
      instructions: systemMessage,
      tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
      stopWhen: stepCountIs(config.maxSteps ?? 20),
      toolChoice: config.toolChoice,
      temperature: config.temperature,
    });

    // Create the agent processing function
    const processMessage = async (
      message: string,
      previousMessages: AgentMessage[] = []
    ): Promise<AgentResponse> => {
      // Create span for model call if tracing is enabled
      const modelSpan = this.tracer?.startSpan('model.call', {
        kind: SpanKind.CLIENT,
        attributes: {
          'agent.id': config.id,
          'model.name': config.model,
          'model.platform': config.platform,
          'model.temperature': config.temperature ?? 0.7,
          'model.maxTokens': config.maxTokens ?? 0,
          'message.length': message.length,
          'history.length': previousMessages.length,
          'agent.maxSteps': config.maxSteps ?? 20,
        },
      });

      const previousActiveSpan = this.tracer?.getActiveSpan();
      if (modelSpan) {
        this.tracer?.setActiveSpan(modelSpan);
      }

      let result;
      try {
        // Use ToolLoopAgent.generate() which handles the tool loop automatically
        // Use messages if we have history, otherwise use prompt
        // Note: maxTokens is not directly supported in generate(), it's set in the agent constructor
        if (previousMessages.length > 0) {
          result = await agent.generate({
            messages: [
              ...previousMessages,
              { role: 'user', content: message },
            ],
          });
        } else {
          result = await agent.generate({
            prompt: message,
          });
        }

        // Record model response attributes
        if (modelSpan) {
          const usage = result.usage;
          // Safely extract usage metrics (usage may have different shapes depending on provider)
          const promptTokens = (usage && 'promptTokens' in usage && typeof usage.promptTokens === 'number') ? usage.promptTokens : 0;
          const completionTokens = (usage && 'completionTokens' in usage && typeof usage.completionTokens === 'number') ? usage.completionTokens : 0;
          const totalTokens = (usage && 'totalTokens' in usage && typeof usage.totalTokens === 'number') ? usage.totalTokens : 0;
          
          modelSpan.setAttributes({
            'response.length': result.text.length,
            'response.finishReason': result.finishReason || 'unknown',
            'usage.promptTokens': promptTokens,
            'usage.completionTokens': completionTokens,
            'usage.totalTokens': totalTokens,
            'toolCalls.count': result.toolCalls ? (Array.isArray(result.toolCalls) ? result.toolCalls.length : 0) : 0,
            'steps.count': result.steps ? (Array.isArray(result.steps) ? result.steps.length : 0) : 0,
          });
          modelSpan.setStatus('ok');
        }
      } catch (error) {
        if (modelSpan && error instanceof Error) {
          modelSpan.recordException(error);
          modelSpan.setStatus('error', error.message);
        }
        throw error;
      } finally {
        if (modelSpan) {
          modelSpan.end();
          // Restore previous active span
          if (previousActiveSpan) {
            this.tracer?.setActiveSpan(previousActiveSpan);
          } else {
            this.tracer?.setActiveSpan(undefined);
          }
        }
      }

      // Extract tool calls if any
      // ToolLoopAgent automatically executes tools and includes results
      // Need to await toolCalls if it's a promise
      const toolCallsArray = result.toolCalls ? await Promise.resolve(result.toolCalls) : [];
      const toolCalls = toolCallsArray.map((tc: any) => ({
        toolId: tc.toolName || tc.toolCallId || 'unknown',
        args: ('args' in tc ? tc.args : {}) as Record<string, any>,
        result: ('result' in tc ? tc.result : undefined),
      }));

      // Check for handoff tool calls
      // Need to check all steps for handoff tool calls
      const handoffCall = toolCalls?.find(tc => tc.toolId === 'handoff_to_agent');
      if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result && handoffCall.result.type === 'handoff') {
        // Return handoff result - will be processed by message pipeline
        return {
          content: result.text,
          toolCalls,
          handoff: handoffCall.result as HandoffResult,
        } as AgentResponse & { handoff?: HandoffResult };
      }

      // ToolLoopAgent handles the tool loop internally, so we just return the final result
      return {
        content: result.text,
        toolCalls,
      };
    };

    // Create streaming function for this agent
    const streamMessage = async function* (
      message: string,
      previousMessages: AgentMessage[] = []
    ): AsyncGenerator<{ textDelta: string; fullText: string; toolCalls?: any[] }, void, unknown> {
      let streamResult;
      try {
        // Use ToolLoopAgent.stream() which handles the tool loop automatically
        // Use messages if we have history, otherwise use prompt (can't use both)
        streamResult = previousMessages.length > 0
          ? await agent.stream({
              messages: [
                ...previousMessages,
                { role: 'user', content: message },
              ],
            })
          : await agent.stream({
              prompt: message,
            });
      } catch (streamError) {
        throw streamError;
      }
      
      const stream = streamResult;

      let fullText = '';
      let toolCalls: any[] | undefined;
      let hasYieldedText = false;

      // Stream text chunks from ToolLoopAgent
      if (stream.textStream && typeof stream.textStream[Symbol.asyncIterator] === 'function') {
        try {
          for await (const chunk of stream.textStream) {
            // Ensure chunk is a string and validate size
            const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB max chunk size
            let chunkText = typeof chunk === 'string' ? chunk : (chunk ? String(chunk) : '');
            
            // Prevent resource exhaustion from extremely large chunks
            if (chunkText.length > MAX_CHUNK_SIZE) {
              console.warn(`[FACTORY] Warning: Chunk size (${chunkText.length} bytes) exceeds maximum (${MAX_CHUNK_SIZE} bytes). Truncating.`);
              chunkText = chunkText.substring(0, MAX_CHUNK_SIZE);
            }
            
            if (chunkText) {
              hasYieldedText = true;
              fullText += chunkText;
              
              yield {
                textDelta: chunkText,
                fullText,
                toolCalls,
              };
            }
          }
        } catch (streamError) {
          // If textStream errors, log but continue to get final result
          console.warn('Error reading textStream:', streamError);
        }
      }

      // Get final result to extract tool calls and check for any remaining text
      const result = await stream;
      
      // Ensure result.text is a string (it might be undefined, null, Promise, or other type)
      let resultText = '';
      if (result.text !== undefined && result.text !== null) {
        if (typeof result.text === 'string') {
          resultText = result.text;
        } else if (result.text instanceof Promise) {
          // If it's a Promise, await it
          resultText = String(await result.text);
        } else {
          // Convert to string
          resultText = String(result.text);
        }
      }
      
      // If textStream didn't yield anything but result.text exists, yield it now
      // This can happen when tools are called and the model doesn't generate text until after tool execution
      if (!hasYieldedText && resultText && resultText.trim()) {
        fullText = resultText;
        yield {
          textDelta: resultText,
          fullText,
          toolCalls,
        };
      } else if (hasYieldedText && resultText && resultText !== fullText) {
        // If we got some text from stream but result.text has more, yield the difference
        const remainingText = resultText.slice(fullText.length);
        if (remainingText) {
          fullText = resultText;
          yield {
            textDelta: remainingText,
            fullText,
            toolCalls,
          };
        }
      } else if (!hasYieldedText && !resultText) {
        // No text at all - update fullText to empty string
        fullText = '';
      } else {
        // Ensure fullText matches result.text
        fullText = resultText || fullText;
      }

      // Handle tool calls from final result
      // ToolLoopAgent automatically executes tools and includes results
      // Need to await toolCalls if it's a promise
      const toolCallsArray = result.toolCalls ? await Promise.resolve(result.toolCalls) : [];
      if (toolCallsArray.length > 0) {
        // Map tool calls from result
        toolCalls = toolCallsArray.map((tc: any) => ({
          toolId: tc.toolName || tc.toolCallId || 'unknown',
          args: ('args' in tc ? tc.args : {}) as Record<string, any>,
          result: ('result' in tc ? tc.result : undefined),
        }));
        
        // If we have tool results but no text, yield the tool calls
        // The caller (Fred's streamMessage) will handle continuation if needed
        if (toolCalls && toolCalls.length > 0 && !hasYieldedText) {
          yield {
            textDelta: '',
            fullText,
            toolCalls,
          };
        } else if (toolCalls && toolCalls.length > 0) {
          // Yield tool calls with current text
          yield {
            textDelta: '',
            fullText,
            toolCalls,
          };
        }
      }
      
      // If we haven't yielded anything yet and we have text, yield it now
      if (!hasYieldedText && fullText) {
        yield {
          textDelta: fullText,
          fullText,
          toolCalls,
        };
      }
      
      // Always yield at least one chunk to indicate completion (even if empty)
      // This ensures the caller knows the stream is complete
      if (!hasYieldedText && !fullText && (!toolCalls || toolCalls.length === 0)) {
        yield {
          textDelta: '',
          fullText: '',
          toolCalls: undefined,
        };
      }
    };

    return { processMessage, streamMessage };
  }
}


