import { Intent, Action } from './core/intent/intent';
import { IntentMatcher } from './core/intent/matcher';
import { IntentRouter } from './core/intent/router';
import { AgentConfig, AgentInstance, AgentResponse } from './core/agent/agent';
import { AgentManager } from './core/agent/manager';
import { PipelineConfig, PipelineInstance } from './core/pipeline';
import { PipelineManager } from './core/pipeline/manager';
import { Tool } from './core/tool/tool';
import { ToolRegistry } from './core/tool/registry';
import { AIProvider, ProviderConfig } from './core/platform/provider';
// OpenAIProvider and GroqProvider are no longer imported here
// They use dynamic imports to avoid requiring packages at build time
import { createDynamicProvider } from './core/platform/dynamic';
import { FrameworkConfig } from './config/types';
import { loadConfig, validateConfig, extractIntents, extractAgents, extractPipelines } from './config/loader';
import { semanticMatch } from './utils/semantic';
import { ContextManager } from './core/context/manager';
import { ModelMessage } from 'ai';
import { convertToModelMessages } from 'ai';
import { HookManager, HookType, HookHandler } from './core/hooks';
import { Tracer, Span } from './core/tracing';
import { NoOpTracer } from './core/tracing/noop-tracer';
import { SpanKind } from './core/tracing/types';
import { setActiveSpan, getActiveSpan } from './core/tracing/context';
import { validateMessageLength } from './utils/validation';

/**
 * Fred - Main class for building AI agents
 */
export class Fred {
  private toolRegistry: ToolRegistry;
  private agentManager: AgentManager;
  private pipelineManager: PipelineManager;
  private intentMatcher: IntentMatcher;
  private intentRouter: IntentRouter;
  private defaultAgentId?: string;
  private contextManager: ContextManager;
  private hookManager: HookManager;
  private tracer?: Tracer;

  constructor(tracer?: Tracer) {
    this.toolRegistry = new ToolRegistry();
    this.tracer = tracer;
    this.agentManager = new AgentManager(this.toolRegistry, tracer);
    this.pipelineManager = new PipelineManager(this.agentManager, tracer);
    this.intentMatcher = new IntentMatcher();
    this.intentRouter = new IntentRouter(this.agentManager);
    this.contextManager = new ContextManager();
    this.hookManager = new HookManager();
    
    // Set tracer on hook manager if provided
    if (this.tracer) {
      this.hookManager.setTracer(this.tracer);
    }
  }

  /**
   * Enable tracing with a tracer instance
   * If no tracer is provided, uses a NoOpTracer (zero overhead)
   */
  enableTracing(tracer?: Tracer): void {
    this.tracer = tracer || new NoOpTracer();
    this.agentManager.setTracer(this.tracer);
    this.pipelineManager.setTracer(this.tracer);
    this.hookManager.setTracer(this.tracer);
  }

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: AIProvider): void {
    this.agentManager.registerProvider(platform, provider);
  }

  /**
   * Use an AI provider (fluent API)
   * Accepts the same parameters as AI SDK providers for full compatibility
   * @param platform - Platform name ('openai', 'groq', 'anthropic', 'google', 'mistral', etc.)
   * @param config - Provider configuration (matches AI SDK provider options)
   * @param config.apiKey - API key for the provider
   * @param config.baseURL - Base URL for the API (useful for custom endpoints or proxies)
   * @param config.headers - Custom headers to include in requests
   * @param config.fetch - Custom fetch implementation
   * @param config.[key] - Additional provider-specific options
   * @returns The provider instance
   * @example
   * // Basic usage with API key
   * const groq = await fred.useProvider('groq', { apiKey: 'your-key' });
   * 
   * // With custom base URL
   * const openai = await fred.useProvider('openai', { 
   *   apiKey: 'your-key',
   *   baseURL: 'https://api.openai.com/v1'
   * });
   * 
   * // With custom headers
   * const anthropic = await fred.useProvider('anthropic', { 
   *   apiKey: 'your-key',
   *   headers: { 'X-Custom-Header': 'value' }
   * });
   * 
   * // With custom fetch
   * const google = await fred.useProvider('google', {
   *   apiKey: 'your-key',
   *   fetch: customFetchImplementation
   * });
   */
  async useProvider(platform: string, config?: ProviderConfig): Promise<AIProvider> {
    const platformLower = platform.toLowerCase();
    
    // Use dynamic provider loading for all platforms
    // This ensures no static imports are required at build time
    const provider = await createDynamicProvider(platformLower, config);
    
    // Register the provider
    this.registerProvider(platformLower, provider);
    
    // Return the provider instance
    return provider;
  }

  /**
   * Use a custom integration/plugin
   * This method is reserved for custom providers and integrations
   * @param name - Integration name
   * @param integration - Integration function or object
   * @returns The Fred instance for chaining
   * @example
   * fred.use('custom-logger', (fred) => {
   *   // Custom integration logic
   * });
   */
  use(name: string, integration: ((fred: Fred) => void) | any): Fred {
    // Store custom integrations for future use
    // This is a placeholder for extensibility
    // Users can implement their own integration logic here
    if (typeof integration === 'function') {
      integration(this);
    }
    return this;
  }

  /**
   * Register default providers (OpenAI and Groq)
   * For other providers, use the .useProvider() method
   */
  async registerDefaultProviders(config?: {
    openai?: ProviderConfig;
    groq?: ProviderConfig;
    [key: string]: ProviderConfig | undefined;
  }): Promise<void> {
    // @ts-ignore - Bun global
    const openaiKey = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;
    // @ts-ignore - Bun global
    const groqKey = typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined;
    
    // Use dynamic provider loading for all providers
    // This ensures no static imports are required at build time
    const providerPromises: Promise<void>[] = [];

    if (openaiKey || config?.openai) {
      providerPromises.push(
        createDynamicProvider('openai', config?.openai)
          .then(provider => {
            this.registerProvider('openai', provider);
          })
          .catch(() => {
            // Silently fail if @ai-sdk/openai is not installed
            // Users can install it with: bun add @ai-sdk/openai
          })
      );
    }

    if (groqKey || config?.groq) {
      providerPromises.push(
        createDynamicProvider('groq', config?.groq)
          .then(provider => {
            this.registerProvider('groq', provider);
          })
          .catch(() => {
            // Silently fail if @ai-sdk/groq is not installed
            // Users can install it with: bun add @ai-sdk/groq
          })
      );
    }
    
    // Register any additional providers from config
    for (const [platform, platformConfig] of Object.entries(config || {})) {
      if (platform !== 'openai' && platform !== 'groq' && platformConfig) {
        // Use dynamic provider for other platforms
        providerPromises.push(
          createDynamicProvider(platform, platformConfig)
            .then(provider => {
              this.registerProvider(platform, provider);
            })
            .catch(() => {
              // Silently fail for optional providers
              // Users can use .useProvider() method for explicit provider registration
            })
        );
      }
    }

    // Wait for all providers to be registered
    await Promise.allSettled(providerPromises);
  }

  /**
   * Register a tool
   */
  registerTool(tool: Tool): void {
    this.toolRegistry.registerTool(tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool[]): void {
    this.toolRegistry.registerTools(tools);
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): Tool | undefined {
    return this.toolRegistry.getTool(id);
  }

  /**
   * Register an intent
   */
  registerIntent(intent: Intent): void {
    this.intentMatcher.registerIntents([intent]);
  }

  /**
   * Register multiple intents
   */
  registerIntents(intents: Intent[]): void {
    this.intentMatcher.registerIntents(intents);
  }

  /**
   * Create an agent from configuration
   */
  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    return this.agentManager.createAgent(config);
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.agentManager.getAgent(id);
  }

  /**
   * Create a pipeline from configuration
   */
  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    return this.pipelineManager.createPipeline(config);
  }

  /**
   * Get a pipeline by ID
   */
  getPipeline(id: string): PipelineInstance | undefined {
    return this.pipelineManager.getPipeline(id);
  }

  /**
   * Get all pipelines
   */
  getAllPipelines(): PipelineInstance[] {
    return this.pipelineManager.getAllPipelines();
  }

  /**
   * Remove a pipeline
   */
  removePipeline(id: string): boolean {
    return this.pipelineManager.removePipeline(id);
  }

  /**
   * Set the default agent (fallback for unmatched messages)
   */
  setDefaultAgent(agentId: string): void {
    if (!this.agentManager.hasAgent(agentId)) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }
    this.defaultAgentId = agentId;
    this.intentRouter.setDefaultAgent(agentId);
  }

  /**
   * Get the default agent ID
   */
  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  /**
   * Route a message to the appropriate handler
   * Returns routing result with agent, pipeline, or intent information
   */
  private async _routeMessage(
    message: string,
    semanticMatcher?: (msg: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number } | null>,
    previousMessages: AgentMessage[] = []
  ): Promise<{
    type: 'agent' | 'pipeline' | 'intent' | 'default' | 'none';
    agent?: AgentInstance;
    agentId?: string;
    pipelineId?: string;
    response?: AgentResponse;
  }> {
    // Routing priority: 1. Agent utterances, 2. Pipeline utterances, 3. Intent matching, 4. Default agent
    // Create span for routing
    const routingSpan = this.tracer?.startSpan('routing', {
      kind: SpanKind.INTERNAL,
    });

    if (routingSpan) {
      this.tracer?.setActiveSpan(routingSpan);
    }

    try {
      // Check agent utterances first (direct routing)
      const agentMatch = await this.agentManager.matchAgentByUtterance(message, semanticMatcher);
      
      if (agentMatch) {
        if (routingSpan) {
          routingSpan.setAttributes({
            'routing.method': 'agent.utterance',
            'routing.agentId': agentMatch.agentId,
            'routing.confidence': agentMatch.confidence,
            'routing.matchType': agentMatch.matchType,
          });
        }

        // Route directly to matched agent
        const agent = this.agentManager.getAgent(agentMatch.agentId);
        if (agent) {
          if (routingSpan) {
            routingSpan.setStatus('ok');
          }
          return {
            type: 'agent',
            agent,
            agentId: agentMatch.agentId,
          };
        } else {
          // Agent not found, fall through to pipeline matching
          if (routingSpan) {
            routingSpan.addEvent('agent.notFound', { 'agent.id': agentMatch.agentId });
          }
        }
      }

      // If no agent match, check pipeline utterances
      if (!agentMatch || (agentMatch && !this.agentManager.getAgent(agentMatch.agentId))) {
        const pipelineMatch = await this.pipelineManager.matchPipelineByUtterance(message, semanticMatcher);
        
        if (pipelineMatch) {
          if (routingSpan) {
            routingSpan.setAttributes({
              'routing.method': 'pipeline.utterance',
              'routing.pipelineId': pipelineMatch.pipelineId,
              'routing.confidence': pipelineMatch.confidence,
              'routing.matchType': pipelineMatch.matchType,
            });
          }

          // Create span for pipeline execution
          const pipelineSpan = this.tracer?.startSpan('pipeline.process', {
            kind: SpanKind.INTERNAL,
            attributes: {
              'pipeline.id': pipelineMatch.pipelineId,
              'pipeline.matchType': pipelineMatch.matchType,
              'pipeline.confidence': pipelineMatch.confidence,
            },
          });

          const previousPipelineSpan = this.tracer?.getActiveSpan();
          if (pipelineSpan) {
            this.tracer?.setActiveSpan(pipelineSpan);
          }

          try {
            const response = await this.pipelineManager.executePipeline(pipelineMatch.pipelineId, message, previousMessages);
            if (pipelineSpan) {
              pipelineSpan.setAttribute('response.length', response.content.length);
              pipelineSpan.setAttribute('response.hasToolCalls', (response.toolCalls?.length ?? 0) > 0);
              pipelineSpan.setStatus('ok');
            }
            if (routingSpan) {
              routingSpan.setStatus('ok');
            }
            return {
              type: 'pipeline',
              pipelineId: pipelineMatch.pipelineId,
              response,
            };
          } catch (error) {
            if (pipelineSpan && error instanceof Error) {
              pipelineSpan.recordException(error);
              pipelineSpan.setStatus('error', error.message);
            }
            throw error;
          } finally {
            pipelineSpan?.end();
            if (previousPipelineSpan) {
              this.tracer?.setActiveSpan(previousPipelineSpan);
            }
          }
        } else {
          // No pipeline match, try intent matching
          const match = await this.intentMatcher.matchIntent(message, semanticMatcher);
          
          if (match) {
            if (routingSpan) {
              routingSpan.setAttributes({
                'routing.method': 'intent.matching',
                'routing.intentId': match.intent.id,
                'routing.confidence': match.confidence,
                'routing.matchType': match.matchType,
              });
            }
            
            // Route to matched intent's action
            if (match.intent.action.type === 'agent') {
              const agent = this.agentManager.getAgent(match.intent.action.target);
              if (agent) {
                if (routingSpan) {
                  routingSpan.setStatus('ok');
                }
                return {
                  type: 'agent',
                  agent,
                  agentId: match.intent.action.target,
                };
              }
            } else {
              // Intent routes to pipeline - execute and return response
              const response = await this.intentRouter.routeIntent(match, message) as AgentResponse;
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'intent',
                response,
              };
            }
          } else if (this.defaultAgentId) {
            if (routingSpan) {
              routingSpan.setAttributes({
                'routing.method': 'default.agent',
                'routing.defaultAgentId': this.defaultAgentId,
              });
            }
            // No intent matched - route to default agent
            const agent = this.agentManager.getAgent(this.defaultAgentId);
            if (agent) {
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'default',
                agent,
                agentId: this.defaultAgentId,
              };
            }
          }
        }
      }

      // No match and no default agent
      if (routingSpan) {
        routingSpan.setStatus('error', 'No routing target found');
      }
      return { type: 'none' };
    } catch (error) {
      if (routingSpan && error instanceof Error) {
        routingSpan.recordException(error);
        routingSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      routingSpan?.end();
    }
  }

  /**
   * Process a user message through the intent system
   */
  async processMessage(
    message: string,
    options?: {
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
      conversationId?: string;
    }
  ): Promise<AgentResponse | null> {
    // Validate message input to prevent resource exhaustion
    validateMessageLength(message);

    // Create root span for message processing
    const rootSpan = this.tracer?.startSpan('processMessage', {
      kind: SpanKind.SERVER,
      attributes: {
        'message.length': message.length,
        'options.useSemanticMatching': options?.useSemanticMatching ?? true,
        'options.semanticThreshold': options?.semanticThreshold ?? 0.6,
      },
    });

    const previousActiveSpan = this.tracer?.getActiveSpan();
    if (rootSpan) {
      this.tracer?.setActiveSpan(rootSpan);
    }

    try {
      const conversationId = options?.conversationId || this.contextManager.generateConversationId();
      const useSemantic = options?.useSemanticMatching ?? true;
      const threshold = options?.semanticThreshold ?? 0.6;

      if (rootSpan) {
        rootSpan.setAttribute('conversation.id', conversationId);
      }

      // Get conversation history (already in ModelMessage format)
      const history = await this.contextManager.getHistory(conversationId);
      
      // Filter to user/assistant messages for agent processing
      // Since AgentMessage is now ModelMessage, we can use history directly
      const previousMessages: AgentMessage[] = history.filter(
        msg => msg.role === 'user' || msg.role === 'assistant'
      ) as AgentMessage[];

      // Add user message to context
      const userMessage: ModelMessage = {
        role: 'user',
        content: message,
      };
      await this.contextManager.addMessage(conversationId, userMessage);

      // Create semantic matcher if enabled
      const semanticMatcher = useSemantic
        ? async (msg: string, utterances: string[]) => {
            return semanticMatch(msg, utterances, threshold);
          }
        : undefined;

      // Route message to appropriate handler
      const route = await this._routeMessage(message, semanticMatcher, previousMessages);

      let response: AgentResponse;
      let usedAgentId: string | null = null;

      // Handle routing result
      if (route.type === 'none') {
        return null;
      }

      if (route.type === 'pipeline' || route.type === 'intent') {
        // Pipeline or intent already executed, use the response
        if (!route.response) {
          throw new Error(`Route type ${route.type} did not return a response`);
        }
        response = route.response;
      } else if (route.type === 'agent' || route.type === 'default') {
        // Agent routing - need to execute
        if (!route.agent) {
          throw new Error(`Route type ${route.type} did not return an agent`);
        }
        usedAgentId = route.agentId || null;
        
        // Create span for agent execution
        const agentSpan = this.tracer?.startSpan('agent.process', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'agent.id': route.agentId || 'unknown',
          },
        });

        const previousAgentSpan = this.tracer?.getActiveSpan();
        if (agentSpan) {
          this.tracer?.setActiveSpan(agentSpan);
        }

        try {
          response = await route.agent.processMessage(message, previousMessages);
          if (agentSpan) {
            agentSpan.setAttribute('response.length', response.content.length);
            agentSpan.setAttribute('response.hasToolCalls', (response.toolCalls?.length ?? 0) > 0);
            agentSpan.setAttribute('response.hasHandoff', response.handoff !== undefined);
            agentSpan.setStatus('ok');
          }
        } catch (error) {
          if (agentSpan && error instanceof Error) {
            agentSpan.recordException(error);
            agentSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
          agentSpan?.end();
          if (previousAgentSpan) {
            this.tracer?.setActiveSpan(previousAgentSpan);
          }
        }
      } else {
        throw new Error(`Unknown route type: ${route.type}`);
      }

      // Process handoffs recursively (with max depth to prevent infinite loops)
      const maxHandoffDepth = 10;
      let handoffDepth = 0;
      let currentResponse = response;
      
      while (currentResponse.handoff && handoffDepth < maxHandoffDepth) {
        handoffDepth++;
        const handoff = currentResponse.handoff;
        
        // Create span for handoff
        const handoffSpan = this.tracer?.startSpan('agent.handoff', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'handoff.depth': handoffDepth,
            'handoff.fromAgent': currentResponse.handoff?.agentId || 'unknown',
            'handoff.toAgent': handoff.agentId,
            'handoff.hasContext': handoff.context !== undefined,
          },
        });

        const previousHandoffSpan = this.tracer?.getActiveSpan();
        if (handoffSpan) {
          this.tracer?.setActiveSpan(handoffSpan);
        }

        try {
          // Get target agent
          const targetAgent = this.agentManager.getAgent(handoff.agentId);
          if (!targetAgent) {
            // Target agent not found, return current response
            if (handoffSpan) {
              handoffSpan.addEvent('agent.notFound', { 'agent.id': handoff.agentId });
              handoffSpan.setStatus('error', 'Target agent not found');
            }
            break;
          }

          // Prepare handoff message (use provided message or original message)
          const handoffMessage = handoff.message || message;
          
          // Add context from handoff if provided
          const handoffContext = handoff.context ? `\n\nContext: ${JSON.stringify(handoff.context)}` : '';
          const messageWithContext = handoffMessage + handoffContext;

          // Process message with target agent
          currentResponse = await targetAgent.processMessage(messageWithContext, previousMessages);
          
          if (handoffSpan) {
            handoffSpan.setAttribute('handoff.response.length', currentResponse.content.length);
            handoffSpan.setStatus('ok');
          }
        } catch (error) {
          if (handoffSpan && error instanceof Error) {
            handoffSpan.recordException(error);
            handoffSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
          handoffSpan?.end();
          if (previousHandoffSpan) {
            this.tracer?.setActiveSpan(previousHandoffSpan);
          }
        }
      }

      if (handoffDepth >= maxHandoffDepth) {
        console.warn('Maximum handoff depth reached. Stopping handoff chain.');
        if (rootSpan) {
          rootSpan.addEvent('handoff.maxDepthReached', { 'maxDepth': maxHandoffDepth });
        }
      }

      if (rootSpan) {
        rootSpan.setAttributes({
          'response.length': currentResponse.content.length,
          'response.hasToolCalls': (currentResponse.toolCalls?.length ?? 0) > 0,
          'handoff.depth': handoffDepth,
        });
        rootSpan.setStatus('ok');
      }

      // Handle tool calls: if there are tool calls with results, add them to context and continue conversation
      if (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
        const hasToolResults = currentResponse.toolCalls.some(tc => tc.result !== undefined);
        
        if (hasToolResults) {
          // Add assistant message with tool calls to context
          // The AI SDK format uses toolCalls array in assistant messages
          const assistantMessage: ModelMessage = {
            role: 'assistant',
            content: currentResponse.content || '', // May be empty if only tool calls
            toolCalls: currentResponse.toolCalls.map((tc, idx) => ({
              toolCallId: `call_${tc.toolId}_${Date.now()}_${idx}`,
              toolName: tc.toolId,
              args: tc.args,
            })),
          };
          await this.contextManager.addMessage(conversationId, assistantMessage);

          // Add tool results to context (AI SDK uses 'tool' role for tool results)
          for (let idx = 0; idx < currentResponse.toolCalls.length; idx++) {
            const toolCall = currentResponse.toolCalls[idx];
            if (toolCall.result !== undefined) {
              const toolCallId = `call_${toolCall.toolId}_${Date.now()}_${idx}`;
              const toolResultMessage: ModelMessage = {
                role: 'tool',
                content: typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result),
                toolCallId,
              };
              await this.contextManager.addMessage(conversationId, toolResultMessage);
            }
          }

          // If there's no content response, continue the conversation automatically
          // This allows the agent to respond to the tool results
          if (!currentResponse.content || currentResponse.content.trim() === '') {
            // Use the agent that generated the original response
            let agent = null;
            
            if (usedAgentId) {
              agent = this.agentManager.getAgent(usedAgentId);
            } else if (this.defaultAgentId) {
              // Fallback to default agent if we couldn't track the original agent
              agent = this.agentManager.getAgent(this.defaultAgentId);
            }
            
            if (agent) {
              // Get updated conversation history with tool results
              // Since AgentMessage is now ModelMessage, we can pass the history directly
              // The AI SDK will handle tool messages properly
              const updatedHistory = await this.contextManager.getHistory(conversationId);
              
              // Filter to messages that should be passed to the agent
              // Include user, assistant, and tool messages (AI SDK handles tool messages)
              const updatedPreviousMessages: AgentMessage[] = updatedHistory.filter(
                msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
              ) as AgentMessage[];

              // Continue conversation with empty message to get agent's response to tool results
              // The agent will see the tool results in the conversation history
              const continuedResponse = await agent.processMessage('', updatedPreviousMessages);
              
              // Add the continued response to context
              const continuedAssistantMessage: ModelMessage = {
                role: 'assistant',
                content: continuedResponse.content,
              };
              await this.contextManager.addMessage(conversationId, continuedAssistantMessage);

              // Merge tool calls from continued response if any
              if (continuedResponse.toolCalls) {
                currentResponse.toolCalls = [
                  ...(currentResponse.toolCalls || []),
                  ...continuedResponse.toolCalls,
                ];
              }

              // Return the continued response with merged tool calls
              return {
                ...continuedResponse,
                toolCalls: currentResponse.toolCalls,
              };
            }
          }
        }
      }

      // Add assistant response to context (if no tool calls or tool calls already handled)
      const assistantMessage: ModelMessage = {
        role: 'assistant',
        content: currentResponse.content,
      };
      await this.contextManager.addMessage(conversationId, assistantMessage);

      return currentResponse;
    } catch (error) {
      if (rootSpan && error instanceof Error) {
        rootSpan.recordException(error);
        rootSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      if (rootSpan) {
        rootSpan.end();
        // Restore previous active span
        if (previousActiveSpan) {
          this.tracer?.setActiveSpan(previousActiveSpan);
        } else {
          this.tracer?.setActiveSpan(undefined);
        }
      }
    }
  }

  /**
   * Stream a user message through the intent system
   * Returns an async generator that yields text deltas as they're generated
   */
  async *streamMessage(
    message: string,
    options?: {
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
      conversationId?: string;
    }
  ): AsyncGenerator<{ textDelta: string; fullText: string; toolCalls?: any[] }, void, unknown> {
    // Validate message input
    validateMessageLength(message);

    const conversationId = options?.conversationId || this.contextManager.generateConversationId();
    const useSemantic = options?.useSemanticMatching ?? true;
    const threshold = options?.semanticThreshold ?? 0.6;

    // Get conversation history (already in ModelMessage format)
    const history = await this.contextManager.getHistory(conversationId);
    
    // Filter to user/assistant messages for agent processing
    // Since AgentMessage is now ModelMessage, we can use history directly
    const previousMessages: AgentMessage[] = history.filter(
      msg => msg.role === 'user' || msg.role === 'assistant'
    ) as AgentMessage[];

    // Add user message to context
    const userMessage: ModelMessage = {
      role: 'user',
      content: message,
    };
    await this.contextManager.addMessage(conversationId, userMessage);

    // Create semantic matcher if enabled
    const semanticMatcher = useSemantic
      ? async (msg: string, utterances: string[]) => {
          return semanticMatch(msg, utterances, threshold);
        }
      : undefined;

    // Route message to appropriate handler
    const route = await this._routeMessage(message, semanticMatcher, previousMessages);

    let agent: AgentInstance | null = null;
    let usedAgentId: string | null = null;

    // Handle routing result
    if (route.type === 'none') {
      throw new Error('No agent found to handle message');
    }

    if (route.type === 'pipeline' || route.type === 'intent') {
      // Pipeline or intent already executed, yield the result as a single chunk
      if (!route.response) {
        throw new Error(`Route type ${route.type} did not return a response`);
      }
      
      // Add assistant response to context
      const assistantMessage: ModelMessage = {
        role: 'assistant',
        content: route.response.content,
      };
      await this.contextManager.addMessage(conversationId, assistantMessage);
      
      yield {
        textDelta: route.response.content,
        fullText: route.response.content,
        toolCalls: route.response.toolCalls,
      };
      return;
    } else if (route.type === 'agent' || route.type === 'default') {
      // Agent routing - use for streaming
      if (!route.agent) {
        throw new Error(`Route type ${route.type} did not return an agent`);
      }
      agent = route.agent;
      usedAgentId = route.agentId || null;
    } else {
      throw new Error(`Unknown route type: ${route.type}`);
    }

    // Stream the message using the agent's streamMessage method
    if (agent.streamMessage) {
      let fullText = '';
      let finalToolCalls: any[] | undefined;
      let hasYieldedAnything = false;

      try {
        for await (const chunk of agent.streamMessage(message, previousMessages)) {
          hasYieldedAnything = true;
          // Only update fullText if chunk has actual content
          if (chunk.fullText) {
            fullText = chunk.fullText;
          }
          if (chunk.toolCalls) {
            finalToolCalls = chunk.toolCalls;
          }
          // Always yield chunks - even if empty, they indicate progress
          yield {
            textDelta: chunk.textDelta || '',
            fullText: chunk.fullText || fullText,
            toolCalls: chunk.toolCalls,
          };
        }
        } catch (streamError) {
          throw streamError;
        }

        if (!hasYieldedAnything) {
      }

      // Add assistant response to context
      const assistantMessage: ModelMessage = {
        role: 'assistant',
        content: fullText,
      };
      await this.contextManager.addMessage(conversationId, assistantMessage);

      // Handle tool calls if any
      if (finalToolCalls && finalToolCalls.length > 0) {
        const hasToolResults = finalToolCalls.some(tc => tc.result !== undefined);
        
        if (hasToolResults) {
          // Add tool calls and results to context
          const toolCallMessage: ModelMessage = {
            role: 'assistant',
            content: '',
            toolCalls: finalToolCalls.map((tc, idx) => ({
              toolCallId: `call_${tc.toolId}_${Date.now()}_${idx}`,
              toolName: tc.toolId,
              args: tc.args,
            })),
          };
          await this.contextManager.addMessage(conversationId, toolCallMessage);

          for (let idx = 0; idx < finalToolCalls.length; idx++) {
            const toolCall = finalToolCalls[idx];
            if (toolCall.result !== undefined) {
              const toolCallId = `call_${toolCall.toolId}_${Date.now()}_${idx}`;
              const toolResultMessage: ModelMessage = {
                role: 'tool',
                content: typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result),
                toolCallId,
              };
              await this.contextManager.addMessage(conversationId, toolResultMessage);
            }
          }

          // Continue streaming if no content was generated after tool execution
          if (!fullText || fullText.trim() === '') {
            const updatedHistory = await this.contextManager.getHistory(conversationId);
            
            // Since AgentMessage is now ModelMessage, we can pass the history directly
            // Include user, assistant, and tool messages (AI SDK handles tool messages)
            const updatedPreviousMessages: AgentMessage[] = updatedHistory.filter(
              msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
            ) as AgentMessage[];

            // Continue streaming with tool results - send empty message to get agent's response
            if (agent.streamMessage) {
              let continuationFullText = '';
              for await (const chunk of agent.streamMessage('', updatedPreviousMessages)) {
                continuationFullText = chunk.fullText;
                yield {
                  textDelta: chunk.textDelta,
                  fullText: continuationFullText,
                  toolCalls: chunk.toolCalls,
                };
              }
              
              // Update fullText with continuation result
              fullText = continuationFullText;
              
              // Add continuation response to context
              if (continuationFullText) {
                const continuationMessage: ModelMessage = {
                  role: 'assistant',
                  content: continuationFullText,
                };
                await this.contextManager.addMessage(conversationId, continuationMessage);
              }
            }
          }
        }
      }
    } else {
      // Fallback to non-streaming if agent doesn't support streaming
      const response = await agent.processMessage(message, previousMessages);
      if (response.content) {
        // Simulate streaming by yielding the full text
        yield {
          textDelta: response.content,
          fullText: response.content,
          toolCalls: response.toolCalls,
        };
      }
    }
  }

  /**
   * Process OpenAI-compatible chat messages
   */
  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: {
      conversationId?: string;
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
    }
  ): Promise<AgentResponse | null> {
    const conversationId = options?.conversationId || this.contextManager.generateConversationId();
    
    // Convert to AI SDK ModelMessage format
    const modelMessages = await convertToModelMessages(messages);
    
    // Get existing conversation history
    const existingHistory = await this.contextManager.getHistory(conversationId);
    
    // Merge with new messages (avoid duplicates)
    const allMessages: ModelMessage[] = [...existingHistory];
    for (const msg of modelMessages) {
      // Simple deduplication - in production, use better logic
      const lastMsg = allMessages[allMessages.length - 1];
      if (!lastMsg || lastMsg.role !== msg.role || lastMsg.content !== msg.content) {
        allMessages.push(msg);
      }
    }
    
    // Update context with all messages
    await this.contextManager.addMessages(conversationId, modelMessages);
    
    // Extract the last user message
    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);

    // Process through intent system
    const response = await this.processMessage(userMessageText, {
      conversationId,
      useSemanticMatching: options?.useSemanticMatching,
      semanticThreshold: options?.semanticThreshold,
    });

    return response;
  }

  /**
   * Get the context manager instance
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Register a hook handler
   * @param type - The hook type to register
   * @param handler - The handler function to execute
   * @example
   * fred.registerHook('beforeToolCalled', async (event) => {
   *   console.log('Tool about to be called:', event.data);
   *   return { context: { timestamp: Date.now() } };
   * });
   */
  registerHook(type: HookType, handler: HookHandler): void {
    this.hookManager.registerHook(type, handler);
  }

  /**
   * Unregister a hook handler
   */
  unregisterHook(type: HookType, handler: HookHandler): boolean {
    return this.hookManager.unregisterHook(type, handler);
  }

  /**
   * Get the hook manager instance
   */
  getHookManager(): HookManager {
    return this.hookManager;
  }

  /**
   * Initialize from a config file
   */
  async initializeFromConfig(
    configPath: string,
    options?: {
      toolExecutors?: Map<string, Tool['execute']>;
      providers?: {
        openai?: ProviderConfig;
        groq?: ProviderConfig;
      };
    }
  ): Promise<void> {
    // Load and validate config
    const config = loadConfig(configPath);
    validateConfig(config);

    // Register providers
    await this.registerDefaultProviders(options?.providers);

    // Register tools (need execute functions)
    if (config.tools) {
      const toolExecutors = options?.toolExecutors || new Map();
      for (const toolDef of config.tools) {
        const executor = toolExecutors.get(toolDef.id);
        if (!executor) {
          throw new Error(
            `Tool "${toolDef.id}" requires an execute function. Provide it in toolExecutors option.`
          );
        }
        this.registerTool({
          ...toolDef,
          execute: executor,
        });
      }
    }

    // Register intents
    const intents = extractIntents(config);
    if (intents.length > 0) {
      this.registerIntents(intents);
    }

    // Create agents (resolve prompt files relative to config path)
    const agents = extractAgents(config, configPath);
    for (const agentConfig of agents) {
      await this.createAgent(agentConfig);
    }

    // Create pipelines (resolve prompt files in inline agents relative to config path)
    const pipelines = extractPipelines(config, configPath);
    for (const pipelineConfig of pipelines) {
      await this.createPipeline(pipelineConfig);
    }
  }

  /**
   * Get all registered intents
   */
  getIntents(): Intent[] {
    return this.intentMatcher.getIntents();
  }

  /**
   * Get all agents
   */
  getAgents(): AgentInstance[] {
    return this.agentManager.getAllAgents();
  }

  /**
   * Get all tools
   */
  getTools(): Tool[] {
    return this.toolRegistry.getAllTools();
  }
}

// Export all types and classes
export * from './core/intent/intent';
export * from './core/agent/agent';
export * from './core/tool/tool';
export * from './core/platform/provider';
export * from './core/platform/openai';
export * from './core/platform/groq';
export * from './config/types';
export { ToolRegistry } from './core/tool/registry';
export { AgentManager } from './core/agent/manager';
export { IntentMatcher } from './core/intent/matcher';
export { IntentRouter } from './core/intent/router';
export { ContextManager } from './core/context/manager';
export * from './core/context/context';
export { HookManager } from './core/hooks/manager';
export * from './core/hooks/types';
export * from './core/tracing';
export { NoOpTracer } from './core/tracing/noop-tracer';
export { createOpenTelemetryTracer, isOpenTelemetryAvailable } from './core/tracing/otel-exporter';
export * from './core/eval/golden-trace';
export { GoldenTraceRecorder } from './core/eval/recorder';
export * from './core/eval/assertions';
export * from './core/eval/assertion-runner';

