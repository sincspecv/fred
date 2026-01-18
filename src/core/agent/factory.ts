import { generateText, streamText, tool, ModelMessage, jsonSchema } from 'ai';
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
 * Agent factory using Vercel AI SDK
 */
export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map(); // Track MCP clients per agent
  private tracer?: Tracer;

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
          // Log error but don't fail agent creation
          console.error(`Failed to initialize MCP server "${mcpConfig.id}":`, error);
          // Continue with other MCP servers
        }
      }
    }
    
    // Convert regular tools to AI SDK format with tracing
    const sdkTools: Record<string, any> = {};
    for (const toolDef of tools) {
      // Wrap tool execution with tracing
      const originalExecute = toolDef.execute;
      const tracedExecute = async (args: any) => {
        const toolSpan = this.tracer?.startSpan('tool.execute', {
          kind: SpanKind.CLIENT,
          attributes: {
            'tool.id': toolDef.id,
            'tool.name': toolDef.name,
            'tool.args': JSON.stringify(args),
          },
        });

        const previousActiveSpan = this.tracer?.getActiveSpan();
        if (toolSpan) {
          this.tracer?.setActiveSpan(toolSpan);
        }

        try {
          const result = await originalExecute(args);
          
          if (toolSpan) {
            toolSpan.setAttributes({
              'tool.result.type': typeof result,
              'tool.result.hasValue': result !== undefined && result !== null,
            });
            // Don't log full result if it's too large (could be sensitive data)
            if (typeof result === 'string' && result.length < 1000) {
              toolSpan.setAttribute('tool.result.preview', result.substring(0, 100));
            }
            toolSpan.setStatus('ok');
          }
          
          return result;
        } catch (error) {
          if (toolSpan && error instanceof Error) {
            toolSpan.recordException(error);
            toolSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
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

      sdkTools[toolDef.id] = tool({
        description: toolDef.description,
        parameters: jsonSchema(toolDef.parameters),
        execute: tracedExecute,
      });
    }
    
    // Merge MCP tools with regular tools
    Object.assign(sdkTools, mcpTools);

    // Create the agent processing function
    const processMessage = async (
      message: string,
      previousMessages: AgentMessage[] = []
    ): Promise<AgentResponse> => {
      // Load system message (handle file paths for programmatic usage)
      // Note: When loaded from config, paths are already resolved in extractAgents
      // For programmatic usage, sandbox to current working directory and disallow absolute paths
      const systemMessage = loadPromptFile(config.systemMessage, undefined, false);

      // Generate response using AI SDK with tracing
      // AgentMessage is now aligned with ModelMessage, so we can use it directly
      const allMessages: ModelMessage[] = [
        ...previousMessages,
        { role: 'user', content: message },
      ];
      
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
        },
      });

      const previousActiveSpan = this.tracer?.getActiveSpan();
      if (modelSpan) {
        this.tracer?.setActiveSpan(modelSpan);
      }

      let result;
      try {
        result = await generateText({
          model,
          system: systemMessage,
          messages: allMessages,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
        });

        // Record model response attributes
        if (modelSpan) {
          modelSpan.setAttributes({
            'response.length': result.text.length,
            'response.finishReason': result.finishReason || 'unknown',
            'usage.promptTokens': result.usage?.promptTokens ?? 0,
            'usage.completionTokens': result.usage?.completionTokens ?? 0,
            'usage.totalTokens': result.usage?.totalTokens ?? 0,
            'toolCalls.count': result.toolCalls?.length ?? 0,
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
      // The AI SDK's generateText should automatically execute tools and include results
      // However, some providers may not populate results automatically, so we check and execute if needed
      const toolCalls = result.toolCalls?.map(tc => ({
        toolId: tc.toolName,
        args: tc.args as Record<string, any>,
        result: tc.result,
      }));

      // Check for handoff tool calls
      const handoffCall = toolCalls?.find(tc => tc.toolId === 'handoff_to_agent');
      if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result && handoffCall.result.type === 'handoff') {
        // Return handoff result - will be processed by message pipeline
        return {
          content: result.text,
          toolCalls,
          handoff: handoffCall.result as HandoffResult,
        } as AgentResponse & { handoff?: HandoffResult };
      }

      // If there are tool calls with results, we need to continue the conversation
      // The AI SDK automatically executes tools, so results are already in toolCalls[].result
      // We need to add tool results to the conversation and continue
      if (toolCalls && toolCalls.length > 0 && toolCalls.some(tc => tc.result !== undefined)) {
        // Tool calls were executed and have results
        // Return the response with tool calls - the caller should continue the conversation
        // by calling processMessage again with an empty message, which will include tool results
        return {
          content: result.text, // May be empty if only tool calls were made
          toolCalls,
        };
      }

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
      // Load system message
      const systemMessage = loadPromptFile(config.systemMessage, undefined, false);

      // Generate response using AI SDK with tracing
      // AgentMessage is now aligned with ModelMessage, so we can use it directly
      const allMessages: ModelMessage[] = [
        ...previousMessages,
        { role: 'user', content: message },
      ];
      
      // Use streamText for streaming with AI SDK v6
      // Enable includeRawChunks to access fullStream for more granular control
      // This allows us to process raw provider chunks even if textStream is buffered
      let stream;
      try {
        stream = await streamText({
          model,
          system: systemMessage,
          messages: allMessages,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          // Enable raw chunks access for more granular streaming control (AI SDK v6)
          includeRawChunks: true,
        });
      } catch (streamError) {
        throw streamError;
      }

      let fullText = '';
      let toolCalls: any[] | undefined;
      let hasYieldedText = false;

      // Try using fullStream first for more granular chunks (AI SDK v6)
      // fullStream provides access to raw provider chunks which may be smaller
      // If fullStream is not available or doesn't work, fall back to textStream
      let streamChunkCount = 0;
      let usedFullStream = false;
      
      // Check if fullStream is available (when includeRawChunks is true)
      if (stream.fullStream && typeof stream.fullStream[Symbol.asyncIterator] === 'function') {
        try {
          usedFullStream = true;
          for await (const part of stream.fullStream) {
            streamChunkCount++;
            
            // Extract text delta from fullStream parts (AI SDK v6)
            // fullStream yields objects with type field - 'text' for text deltas
            // We prioritize raw chunks as they may be smaller/more granular
            let chunkText = '';
            
            // First, try to get raw chunks - these are the actual provider chunks
            // and may be smaller than aggregated text deltas
            // Type safety: We use type assertions here because AI SDK v6's fullStream
            // types are not fully exported, but we validate the structure before use
            if (part.type === 'raw' && 'rawValue' in part) {
              // Raw chunks from provider (when includeRawChunks: true)
              // These are the actual chunks from the provider API
              const rawValue = (part as { rawValue?: unknown }).rawValue;
              if (typeof rawValue === 'string') {
                chunkText = rawValue;
              } else if (rawValue && typeof rawValue === 'object' && rawValue !== null) {
                // Raw value might be an object - try to extract text content
                // For SSE streams, this might contain delta.content or similar
                // Validate structure before accessing nested properties
                const rawObj = rawValue as Record<string, unknown>;
                if (Array.isArray(rawObj.choices) && rawObj.choices.length > 0) {
                  const choice = rawObj.choices[0] as Record<string, unknown>;
                  if (choice && typeof choice === 'object' && 'delta' in choice) {
                    const delta = choice.delta as Record<string, unknown>;
                    if (delta && typeof delta === 'object' && typeof delta.content === 'string') {
                      chunkText = delta.content;
                    }
                  }
                } else if (rawObj.delta && typeof rawObj.delta === 'object' && rawObj.delta !== null) {
                  const delta = rawObj.delta as Record<string, unknown>;
                  if (typeof delta.content === 'string') {
                    chunkText = delta.content;
                  }
                } else if (typeof rawObj.content === 'string') {
                  chunkText = rawObj.content;
                }
              }
            } else if (part.type === 'text' && 'text' in part) {
              // AI SDK v6: text deltas have type 'text' with a 'text' property
              const textPart = part as { text?: unknown };
              if (typeof textPart.text === 'string') {
                chunkText = textPart.text;
              }
            } else if (part.type === 'text-delta') {
              // Fallback for v5 compatibility or alternative format
              const deltaPart = part as { textDelta?: unknown; delta?: unknown };
              if (typeof deltaPart.textDelta === 'string') {
                chunkText = deltaPart.textDelta;
              } else if (typeof deltaPart.delta === 'string') {
                chunkText = deltaPart.delta;
              }
            }
            
            // Validate chunk size before processing
            const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB max chunk size
            if (chunkText && chunkText.length > MAX_CHUNK_SIZE) {
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
        } catch (fullStreamError) {
          console.warn('[FACTORY] Error reading fullStream, falling back to textStream:', fullStreamError);
          usedFullStream = false;
        }
      }
      
      // Fall back to textStream if fullStream didn't work or wasn't available
      if (!usedFullStream) {
        if (!stream.textStream || typeof stream.textStream[Symbol.asyncIterator] !== 'function') {
          throw new Error('streamText returned no textStream for streaming');
        }
        
        try {
          for await (const chunk of stream.textStream) {
            streamChunkCount++;
            
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

      // Handle tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Map tool calls from result
        toolCalls = result.toolCalls.map(tc => ({
          toolId: tc.toolName,
          args: tc.args as Record<string, any>,
          result: tc.result,
        }));
        
        // If we have tool results but no text, yield the tool calls
        // The caller (Fred's streamMessage) will handle continuation
        if (toolCalls && toolCalls.length > 0) {
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


