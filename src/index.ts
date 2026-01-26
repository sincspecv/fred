import { Intent, Action } from './core/intent/intent';
import { IntentMatcher } from './core/intent/matcher';
import { IntentRouter } from './core/intent/router';
import { AgentConfig, AgentInstance, AgentResponse, AgentMessage } from './core/agent/agent';
import { AgentManager } from './core/agent/manager';
import { PipelineConfig, PipelineInstance } from './core/pipeline';
import { PipelineManager, ResumeResult } from './core/pipeline/manager';
import type { PendingPause, HumanInputResumeOptions } from './core/pipeline/pause/types';
import { Tool } from './core/tool/tool';
import { ToolRegistry } from './core/tool/registry';
import { createCalculatorTool } from './core/tool/calculator';
import {
  ProviderConfig,
  ProviderConfigInput,
  ProviderDefinition,
  ProviderModelDefaults,
} from './core/platform/provider';
import type { EffectProviderFactory } from './core/platform/base';
import { ProviderRegistry } from './core/platform/registry';
import { BUILTIN_PACKS } from './core/platform/packs';
import {
  loadConfig,
  validateConfig,
  extractIntents,
  extractAgents,
  extractPipelines,
  extractWorkflows,
  extractProviders,
  extractObservability,
} from './config/loader';
import { loadPromptFile } from './utils/prompt-loader';
import { semanticMatch } from './utils/semantic';
import { ContextManager } from './core/context/manager';
import { PostgresContextStorage } from './core/context/storage/postgres';
import { SqliteContextStorage } from './core/context/storage/sqlite';
import {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from './core/pipeline/checkpoint';
import type { CheckpointStorage } from './core/pipeline/checkpoint';
import { Prompt } from '@effect/ai';
import { HookManager, HookType, HookHandler } from './core/hooks';
import { Tracer, Span } from './core/tracing';
import { NoOpTracer } from './core/tracing/noop-tracer';
import { SpanKind } from './core/tracing/types';
import { setActiveSpan, getActiveSpan } from './core/tracing/context';
import { validateMessageLength } from './utils/validation';
import { Effect, Stream } from 'effect';
import type { StreamEvent } from './core/stream/events';
import { MessageRouter } from './core/routing/router';
import { RoutingConfig, RoutingDecision } from './core/routing/types';
import { WorkflowManager } from './core/workflow/manager';
import { Workflow } from './core/workflow/types';
import { buildObservabilityLayers, type ObservabilityLayers } from './core/observability/otel';
import type { ObservabilityConfig } from './config/types';

/**
 * Fred - Main class for building AI agents
 */
export class Fred {
  private toolRegistry: ToolRegistry;
  private agentManager: AgentManager;
  private providerRegistry: ProviderRegistry;
  private pipelineManager: PipelineManager;
  private intentMatcher: IntentMatcher;
  private intentRouter: IntentRouter;
  private defaultAgentId?: string;
  private contextManager: ContextManager;
  private memoryDefaults: {
    policy?: {
      maxMessages?: number;
      maxChars?: number;
      strict?: boolean;
      isolated?: boolean;
    };
    requireConversationId?: boolean;
    sequentialVisibility?: boolean;
  } = {};
  private hookManager: HookManager;
  private tracer?: Tracer;
  private messageRouter?: MessageRouter;
  private workflowManager?: WorkflowManager;
  private observabilityLayers?: ObservabilityLayers;

  constructor(tracer?: Tracer) {
    this.toolRegistry = new ToolRegistry();
    this.tracer = tracer;
    this.providerRegistry = new ProviderRegistry();
    this.agentManager = new AgentManager(this.toolRegistry, tracer);
    this.intentMatcher = new IntentMatcher();
    this.intentRouter = new IntentRouter(this.agentManager);
    this.contextManager = new ContextManager();
    this.pipelineManager = new PipelineManager(this.agentManager, tracer, this.contextManager);
    this.hookManager = new HookManager();
    
    // Set tracer on hook manager if provided
    if (this.tracer) {
      this.hookManager.setTracer(this.tracer);
    }
    
    // Register built-in tools
    this.registerBuiltInTools();
    
    // Register shutdown hooks for MCP client cleanup
    this.agentManager.registerShutdownHooks();
  }

  /**
   * Register built-in tools that are available by default
   * These tools are automatically available to all agents
   */
  private registerBuiltInTools(): void {
    // Register calculator tool
    const calculatorTool = createCalculatorTool();
    this.toolRegistry.registerTool(calculatorTool);
  }

  /**
   * Enable tracing with a tracer instance
   * If no tracer is provided, uses a NoOpTracer (zero overhead)
   */
  enableTracing(tracer?: Tracer): void {
    this.tracer = tracer || new NoOpTracer();
    this.agentManager.setTracer(this.tracer);
    this.pipelineManager.setTracer(this.tracer);
    this.pipelineManager.setContextManager(this.contextManager);
    this.hookManager.setTracer(this.tracer);
  }

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: ProviderDefinition): void {
    this.providerRegistry.registerDefinition(provider);
    this.agentManager.registerProvider(platform, provider);
  }

  private syncProviderRegistry(): void {
    for (const definition of this.providerRegistry.getDefinitions()) {
      this.agentManager.registerProvider(definition.id, definition);
      for (const alias of definition.aliases) {
        this.agentManager.registerProvider(alias, definition);
      }
    }
  }

  /**
   * List registered provider IDs
   */
  listProviders(): string[] {
    return this.agentManager.listProviders();
  }

  /**
   * Use an AI provider (fluent API)
   * Accepts provider configuration compatible with Effect provider packs
   * @param platform - Platform name ('openai', 'anthropic', 'google', etc.)
   * @param config - Provider configuration (API key env var name, base URL, headers)
   * @param config.apiKeyEnvVar - Environment variable containing the API key
   * @param config.baseUrl - Base URL for the API (useful for custom endpoints or proxies)
   * @param config.headers - Custom headers to include in requests
   * @param config.[key] - Additional provider-specific options
   * @returns The provider instance
   * @example
   * // Basic usage with API key env var
   * const openai = await fred.useProvider('openai', { apiKeyEnvVar: 'OPENAI_API_KEY' });
   * 
   * // With custom base URL
   * const openai = await fred.useProvider('openai', { 
   *   apiKeyEnvVar: 'OPENAI_API_KEY',
   *   baseUrl: 'https://api.openai.com/v1'
   * });
   * 
   * // With custom headers
   * const anthropic = await fred.useProvider('anthropic', { 
   *   apiKeyEnvVar: 'ANTHROPIC_API_KEY',
   *   headers: { 'X-Custom-Header': 'value' }
   * });
   * 
   * // With custom fetch
   * const google = await fred.useProvider('google', {
   *   apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY'
   * });
   */
  async useProvider(platform: string, config?: ProviderConfig): Promise<ProviderDefinition> {
    const platformLower = platform.toLowerCase();
    await this.registerProviderPack(platformLower, config ?? {});

    const provider = this.providerRegistry.getDefinition(platformLower);
    if (!provider) {
      throw new Error(`Failed to load provider: ${platformLower}`);
    }

    return provider;
  }

  /**
   * Register a provider pack programmatically.
   * Can be called before or after initializeFromConfig.
   *
   * @param idOrPackage - Provider ID (for built-ins) or npm package name
   * @param config - Optional provider configuration
   *
   * @example
   * // Register external pack
   * await fred.registerProviderPack('@fred/provider-mistral', {
   *   apiKeyEnvVar: 'MISTRAL_API_KEY',
   *   modelDefaults: { model: 'mistral-large-latest' }
   * });
   *
   * // Register built-in with custom config
   * await fred.registerProviderPack('openai', {
   *   baseUrl: 'https://custom-endpoint.com/v1'
   * });
   */
  async registerProviderPack(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    await this.providerRegistry.register(idOrPackage, config);
    this.syncProviderRegistry();
  }

  /**
   * Register a provider factory directly (for custom providers).
   *
   * @param factory - Provider factory implementing EffectProviderFactory
   * @param config - Optional provider configuration
   */
  async registerProviderFactory(
    factory: EffectProviderFactory,
    config: ProviderConfig = {}
  ): Promise<void> {
    await this.providerRegistry.registerFactory(factory, config);
    this.syncProviderRegistry();
  }

  /**
   * List all registered provider IDs.
   */
  listProviders(): string[] {
    return this.providerRegistry.listProviders();
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(providerId: string): boolean {
    return this.providerRegistry.hasProvider(providerId);
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
   * Register default providers from config or environment
   * Providers load lazily through Effect provider packs
   */
  async registerDefaultProviders(config?: ProviderConfigInput): Promise<void> {
    if (config?.providers && config.providers.length > 0) {
      const defaults: ProviderModelDefaults | undefined = config.modelDefaults
        ? { ...config.modelDefaults, model: config.defaultModel ?? config.modelDefaults.model }
        : config.defaultModel
          ? { model: config.defaultModel }
          : undefined;

      await Promise.all(
        config.providers.map((registration) => {
          const resolvedId = config.aliases?.[registration.id] ?? registration.id;
          const resolvedConfig: ProviderConfig = {
            ...registration.config,
            modelDefaults: registration.modelDefaults ?? defaults,
          };
          return this.providerRegistry.register(resolvedId, resolvedConfig);
        })
      );
    } else {
      await this.loadDefaultProviders();
    }

    this.providerRegistry.markInitialized();
    this.syncProviderRegistry();
  }

  private async loadDefaultProviders(): Promise<void> {
    for (const [id, factory] of Object.entries(BUILTIN_PACKS)) {
      try {
        await this.providerRegistry.registerFactory(factory, {});
      } catch (error) {
        console.debug(`Built-in provider ${id} not available:`, error);
      }
    }
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
   * Configure rule-based routing for messages.
   * When configured, MessageRouter is used instead of utterance/intent matching.
   *
   * @param config - Routing configuration with rules and default agent
   * @example
   * fred.configureRouting({
   *   defaultAgent: 'general-agent',
   *   rules: [
   *     { id: 'support', agent: 'support-agent', keywords: ['help', 'support'] },
   *     { id: 'sales', agent: 'sales-agent', patterns: ['pricing.*', 'buy'] },
   *   ],
   *   debug: true,
   * });
   */
  configureRouting(config: RoutingConfig): void {
    this.messageRouter = new MessageRouter(
      this.agentManager,
      this.hookManager,
      config
    );
  }

  /**
   * Configure workflows for multiple entry points.
   * Creates a WorkflowManager and registers all provided workflows.
   *
   * @param workflows - Array of workflow definitions
   * @example
   * fred.configureWorkflows([
   *   {
   *     name: 'support',
   *     defaultAgent: 'support-agent',
   *     agents: ['support-agent', 'escalation-agent'],
   *   },
   *   {
   *     name: 'sales',
   *     defaultAgent: 'sales-agent',
   *     agents: ['sales-agent', 'pricing-agent'],
   *   },
   * ]);
   */
  configureWorkflows(workflows: Workflow[]): void {
    this.workflowManager = new WorkflowManager(this);
    for (const workflow of workflows) {
      this.workflowManager.addWorkflow(workflow.name, {
        defaultAgent: workflow.defaultAgent,
        agents: workflow.agents,
        routing: workflow.routing,
      });
    }
  }

  /**
   * Get the workflow manager instance (if configured).
   *
   * @returns WorkflowManager instance or undefined if workflows not configured
   */
  getWorkflowManager(): WorkflowManager | undefined {
    return this.workflowManager;
  }

  /**
   * Test routing without executing the agent (dry-run).
   * Useful for debugging and verifying routing rules.
   *
   * @param message - The message to test
   * @param metadata - Optional metadata for routing (threadId, userId, etc.)
   * @returns Routing decision or null if routing is not configured
   * @example
   * const decision = await fred.testRoute('I need help', { userId: 'alice' });
   * console.log(decision?.agent); // 'support-agent'
   * console.log(decision?.fallback); // false
   */
  async testRoute(
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<RoutingDecision | null> {
    if (!this.messageRouter) return null;
    return this.messageRouter.testRoute(message, metadata ?? {});
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
      // If MessageRouter is configured, use rule-based routing
      if (this.messageRouter) {
        const decision = await this.messageRouter.route(message, {});

        if (routingSpan) {
          routingSpan.setAttributes({
            'routing.method': decision.fallback ? 'message.router.fallback' : 'message.router.rule',
            'routing.agentId': decision.agent,
            'routing.fallback': decision.fallback,
          });
          if (decision.rule) {
            routingSpan.setAttribute('routing.ruleId', decision.rule.id);
          }
          if (decision.matchType) {
            routingSpan.setAttribute('routing.matchType', decision.matchType);
          }
        }

        const agent = this.agentManager.getAgent(decision.agent);
        if (agent) {
          if (routingSpan) {
            routingSpan.setStatus('ok');
          }
          return {
            type: decision.fallback ? 'default' : 'agent',
            agent,
            agentId: decision.agent,
          };
        } else {
          // Agent not found - this shouldn't happen if fallback works correctly
          if (routingSpan) {
            routingSpan.addEvent('agent.notFound', { 'agent.id': decision.agent });
            routingSpan.setStatus('error', `Agent ${decision.agent} not found`);
          }
          return { type: 'none' };
        }
      }

      // Otherwise, use existing routing (agent utterances, pipelines, intents)
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
            const response = await this.pipelineManager.executePipeline(
              pipelineMatch.pipelineId,
              message,
              previousMessages,
              {
                conversationId,
                sequentialVisibility,
              }
            );
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
      requireConversationId?: boolean;
      sequentialVisibility?: boolean;
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
      const requireConversationId = options?.requireConversationId ?? this.memoryDefaults.requireConversationId;
      const conversationId = options?.conversationId
        ? options.conversationId
        : requireConversationId
          ? undefined
          : this.contextManager.generateConversationId();
      const useSemantic = options?.useSemanticMatching ?? true;
      const threshold = options?.semanticThreshold ?? 0.6;

      if (!conversationId) {
        throw new Error('Conversation ID is required for this request');
      }

      if (rootSpan) {
        rootSpan.setAttribute('conversation.id', conversationId);
      }

      // Get conversation history (already in Prompt message format)
      const history = await this.contextManager.getHistory(conversationId);

      // Filter to user/assistant messages for agent processing
      // Since AgentMessage is Prompt message-encoded, we can use history directly
      const previousMessages: AgentMessage[] = history.filter(
        msg => msg.role === 'user' || msg.role === 'assistant'
      ) as AgentMessage[];

      // Create semantic matcher if enabled
      const semanticMatcher = useSemantic
        ? async (msg: string, utterances: string[]) => {
            return semanticMatch(msg, utterances, threshold);
          }
        : undefined;

      // Route message to appropriate handler
      const sequentialVisibility = options?.sequentialVisibility ?? this.memoryDefaults.sequentialVisibility ?? true;
      const route = await this._routeMessage(
        message,
        semanticMatcher,
        sequentialVisibility ? previousMessages : []
      );

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
          response = await route.agent.processMessage(
            message,
            sequentialVisibility ? previousMessages : []
          );
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

      // Check if the routed agent allows history persistence (default: true)
      const routedAgent = usedAgentId ? this.agentManager.getAgent(usedAgentId) : route.agent;
      const shouldPersistHistory = routedAgent?.config.persistHistory !== false;

      if (shouldPersistHistory) {
        // Add user message to context
        const userMessage: Prompt.MessageEncoded = {
          role: 'user',
          content: message,
        };
        await this.contextManager.addMessage(conversationId, userMessage);

        // Handle tool calls: add them to context for persistence
        // Tools are executed inside the Effect LanguageModel loop, so we don't need to
        // continue the conversation manually. The response is already the final response.
        if (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
          const hasToolResults = currentResponse.toolCalls.some(tc => tc.result !== undefined);

          if (hasToolResults) {
            // Add assistant message with tool calls to context
            // Use toolCalls array in assistant messages for tool results
            const baseTimestamp = Date.now();
            const toolCallIds = currentResponse.toolCalls.map(
              (toolCall, idx) => `call_${toolCall.toolId}_${baseTimestamp}_${idx}`
            );
            const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
            if (currentResponse.content) {
              assistantParts.push(Prompt.makePart('text', { text: currentResponse.content }));
            }
            currentResponse.toolCalls.forEach((toolCall, idx) => {
              assistantParts.push(
                Prompt.makePart('tool-call', {
                  id: toolCallIds[idx],
                  name: toolCall.toolId,
                  params: toolCall.args,
                  providerExecuted: false,
                })
              );
            });
            await this.contextManager.addMessage(conversationId, {
              role: 'assistant',
              content: assistantParts,
            });

            // Add tool results to context ("tool" role for tool results)
            for (let idx = 0; idx < currentResponse.toolCalls.length; idx++) {
              const toolCall = currentResponse.toolCalls[idx];
              if (toolCall.result !== undefined) {
                await this.contextManager.addMessage(conversationId, {
                  role: 'tool',
                  content: [
                    Prompt.makePart('tool-result', {
                      id: toolCallIds[idx],
                      name: toolCall.toolId,
                      result: toolCall.result,
                      isFailure: false,
                      providerExecuted: false,
                    }),
                  ],
                });
              }
            }
          }
        }

        // Add assistant response to context only if no tool calls were handled
        // (Tool calls already include the text content in the assistant message)
        const toolCallsHandled = currentResponse.toolCalls &&
          currentResponse.toolCalls.length > 0 &&
          currentResponse.toolCalls.some(tc => tc.result !== undefined);

        if (currentResponse.content && !toolCallsHandled) {
          const assistantMessage: Prompt.MessageEncoded = {
            role: 'assistant',
            content: currentResponse.content,
          };
          await this.contextManager.addMessage(conversationId, assistantMessage);
        }
      }

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
   * Returns an async iterable that yields stream events as they're generated
   */
  streamMessage(
    message: string,
    options?: {
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
      conversationId?: string;
      requireConversationId?: boolean;
      sequentialVisibility?: boolean;
    }
  ): AsyncIterable<StreamEvent> {
    const requireConversationId = options?.requireConversationId ?? this.memoryDefaults.requireConversationId;
    const conversationId = options?.conversationId
      ? options.conversationId
      : requireConversationId
        ? undefined
        : this.contextManager.generateConversationId();
    const useSemantic = options?.useSemanticMatching ?? true;
    const threshold = options?.semanticThreshold ?? 0.6;
    const sequentialVisibility = options?.sequentialVisibility ?? this.memoryDefaults.sequentialVisibility ?? true;

    const initEffect = Effect.gen(function* () {
      validateMessageLength(message);
      if (!conversationId) {
        return yield* Effect.fail(new Error('Conversation ID is required for this request'));
      }

      const history = yield* Effect.promise(() => this.contextManager.getHistory(conversationId));

      const previousMessages: AgentMessage[] = history.filter(
        msg => msg.role === 'user' || msg.role === 'assistant'
      ) as AgentMessage[];

      const semanticMatcher = useSemantic
        ? async (msg: string, utterances: string[]) => {
            return semanticMatch(msg, utterances, threshold);
          }
        : undefined;

      const route = yield* Effect.promise(() =>
        this._routeMessage(message, semanticMatcher, sequentialVisibility ? previousMessages : [])
      );

      return { route, previousMessages };
    }.bind(this));

    const streamEffect = initEffect.pipe(
      Effect.flatMap(({ route, previousMessages }) =>
        Effect.gen(function* () {
          if (route.type === 'none') {
            return yield* Effect.fail(new Error('No agent found to handle message'));
          }

          if (route.type === 'pipeline' || route.type === 'intent') {
            if (!route.response) {
              return yield* Effect.fail(new Error(`Route type ${route.type} did not return a response`));
            }

            // For pipelines/intents, persist history by default (no specific agent to check)
            const userMessage: Prompt.MessageEncoded = {
              role: 'user',
              content: message,
            };
            yield* Effect.promise(() => this.contextManager.addMessage(conversationId, userMessage));

            const assistantMessage: Prompt.MessageEncoded = {
              role: 'assistant',
              content: route.response.content,
            };
            yield* Effect.promise(() => this.contextManager.addMessage(conversationId, assistantMessage));

            const startedAt = Date.now();
            const runId = `run_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
            const messageId = `msg_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
            let sequence = 0;
            const initialEvents: StreamEvent[] = [
              {
                type: 'run-start',
                sequence: sequence++,
                emittedAt: startedAt,
                runId,
                threadId: conversationId,
                input: {
                  message,
                  previousMessages,
                },
                startedAt,
              },
              {
                type: 'message-start',
                sequence: sequence++,
                emittedAt: startedAt,
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                role: 'assistant',
              },
            ];

            const bodyEvents: StreamEvent[] = [];

            if (route.response.content) {
              bodyEvents.push({
                type: 'token',
                sequence: sequence++,
                emittedAt: Date.now(),
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                delta: route.response.content,
                accumulated: route.response.content,
              });
            }

            if (route.response.usage) {
              bodyEvents.push({
                type: 'usage',
                sequence: sequence++,
                emittedAt: Date.now(),
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                usage: route.response.usage,
              });
            }

            const finishedAt = Date.now();
            bodyEvents.push({
              type: 'message-end',
              sequence: sequence++,
              emittedAt: finishedAt,
              runId,
              threadId: conversationId,
              messageId,
              step: 0,
              finishedAt,
              finishReason: 'stop',
            });

            bodyEvents.push({
              type: 'run-end',
              sequence: sequence++,
              emittedAt: finishedAt,
              runId,
              threadId: conversationId,
              finishedAt,
              durationMs: finishedAt - startedAt,
              result: {
                content: route.response.content,
                toolCalls: route.response.toolCalls,
                usage: route.response.usage,
              },
            });

            return Stream.fromIterable(initialEvents).pipe(Stream.concat(Stream.fromIterable(bodyEvents)));
          }

          if (route.type === 'agent' || route.type === 'default') {
            if (!route.agent) {
              return yield* Effect.fail(new Error(`Route type ${route.type} did not return an agent`));
            }

            const agent = route.agent;
            const shouldPersistHistory = agent.config.persistHistory !== false;

            if (agent.streamMessage) {
              // Add user message if persistence is enabled
              if (shouldPersistHistory) {
                yield* Effect.promise(() =>
                  this.contextManager.addMessage(conversationId, {
                    role: 'user',
                    content: message,
                  })
                );
              }

              // Track per-step state for persistence
              type StepState = {
                stepIndex: number;
                text: string;
                toolCalls: Array<{
                  id: string;
                  toolName: string;
                  args: Record<string, unknown>;
                  result?: unknown;
                  isFailure?: boolean;
                }>;
              };

              const stepStates = new Map<number, StepState>();

              const getOrCreateStepState = (stepIndex: number): StepState => {
                if (!stepStates.has(stepIndex)) {
                  stepStates.set(stepIndex, {
                    stepIndex,
                    text: '',
                    toolCalls: [],
                  });
                }
                return stepStates.get(stepIndex)!;
              };

              const updates = agent.streamMessage(
                message,
                sequentialVisibility ? previousMessages : [],
                { threadId: conversationId }
              );
              return updates.pipe(
                Stream.tap((event) => {
                  // Track per-step text and tool calls/results
                  if (event.type === 'token' && 'step' in event) {
                    const state = getOrCreateStepState(event.step);
                    state.text = event.accumulated;
                  }

                  if (event.type === 'tool-call' && 'step' in event) {
                    const state = getOrCreateStepState(event.step);
                    state.toolCalls.push({
                      id: event.toolCallId,
                      toolName: event.toolName,
                      args: event.input,
                    });
                  }

                  if (event.type === 'tool-result' && 'step' in event) {
                    const state = getOrCreateStepState(event.step);
                    const toolCall = state.toolCalls.find(tc => tc.id === event.toolCallId);
                    if (toolCall) {
                      toolCall.result = event.output;
                      toolCall.isFailure = false;
                    }
                  }

                  if (event.type === 'tool-error' && 'step' in event) {
                    const state = getOrCreateStepState(event.step);
                    const toolCall = state.toolCalls.find(tc => tc.id === event.toolCallId);
                    if (toolCall) {
                      toolCall.result = event.error.message;
                      toolCall.isFailure = true;
                    }
                  }

                  // On step-complete, persist history for that step
                  if (event.type === 'step-complete' && shouldPersistHistory) {
                    const state = stepStates.get(event.stepIndex);
                    if (state && state.toolCalls.length > 0) {
                      // Persist assistant message with tool calls
                      return Effect.promise(async () => {
                        const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
                        if (state.text) {
                          assistantParts.push(Prompt.makePart('text', { text: state.text }));
                        }
                        state.toolCalls.forEach((tc) => {
                          assistantParts.push(
                            Prompt.makePart('tool-call', {
                              id: tc.id,
                              name: tc.toolName,
                              params: tc.args,
                              providerExecuted: false,
                            })
                          );
                        });
                        await this.contextManager.addMessage(conversationId, {
                          role: 'assistant',
                          content: assistantParts,
                        });

                        // Add tool results
                        for (const tc of state.toolCalls) {
                          if (tc.result !== undefined) {
                            await this.contextManager.addMessage(conversationId, {
                              role: 'tool',
                              content: [
                                Prompt.makePart('tool-result', {
                                  id: tc.id,
                                  name: tc.toolName,
                                  result: tc.result,
                                  isFailure: tc.isFailure ?? false,
                                  providerExecuted: false,
                                }),
                              ],
                            });
                          }
                        }

                        // Clear step state after persistence
                        stepStates.delete(event.stepIndex);
                      });
                    }
                  }

                  return Effect.void;
                })
              );
            }

            // Add user message if persistence is enabled
            if (shouldPersistHistory) {
              yield* Effect.promise(() =>
                this.contextManager.addMessage(conversationId, {
                  role: 'user',
                  content: message,
                })
              );
            }

            const response = yield* Effect.promise(() =>
              agent.processMessage(message, sequentialVisibility ? previousMessages : [])
            );
            if (response.content && shouldPersistHistory) {
              yield* Effect.promise(() =>
                this.contextManager.addMessage(conversationId, {
                  role: 'assistant',
                  content: response.content,
                })
              );
            }
            const startedAt = Date.now();
            const runId = `run_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
            const messageId = `msg_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
            let sequence = 0;
            const initialEvents: StreamEvent[] = [
              {
                type: 'run-start',
                sequence: sequence++,
                emittedAt: startedAt,
                runId,
                threadId: conversationId,
                input: {
                  message,
                  previousMessages,
                },
                startedAt,
              },
              {
                type: 'message-start',
                sequence: sequence++,
                emittedAt: startedAt,
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                role: 'assistant',
              },
            ];

            const bodyEvents: StreamEvent[] = [];

            if (response.content) {
              bodyEvents.push({
                type: 'token',
                sequence: sequence++,
                emittedAt: Date.now(),
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                delta: response.content,
                accumulated: response.content,
              });
            }

            if (response.usage) {
              bodyEvents.push({
                type: 'usage',
                sequence: sequence++,
                emittedAt: Date.now(),
                runId,
                threadId: conversationId,
                messageId,
                step: 0,
                usage: response.usage,
              });
            }

            const finishedAt = Date.now();
            bodyEvents.push({
              type: 'message-end',
              sequence: sequence++,
              emittedAt: finishedAt,
              runId,
              threadId: conversationId,
              messageId,
              step: 0,
              finishedAt,
              finishReason: 'stop',
            });

            bodyEvents.push({
              type: 'run-end',
              sequence: sequence++,
              emittedAt: finishedAt,
              runId,
              threadId: conversationId,
              finishedAt,
              durationMs: finishedAt - startedAt,
              result: {
                content: response.content,
                toolCalls: response.toolCalls,
                usage: response.usage,
              },
            });

            return Stream.fromIterable(initialEvents).pipe(Stream.concat(Stream.fromIterable(bodyEvents)));
          }

          return yield* Effect.fail(new Error(`Unknown route type: ${route.type}`));
        }.bind(this))
      )
    );

    return Stream.toAsyncIterable(Stream.unwrap(streamEffect));
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
      requireConversationId?: boolean;
      sequentialVisibility?: boolean;
    }
  ): Promise<AgentResponse | null> {
    const requireConversationId = options?.requireConversationId ?? this.memoryDefaults.requireConversationId;
    const conversationId = options?.conversationId
      ? options.conversationId
      : requireConversationId
        ? undefined
        : this.contextManager.generateConversationId();
    
    if (!conversationId) {
      throw new Error('Conversation ID is required for this request');
    }

    const modelMessages: Prompt.MessageEncoded[] = messages.map((message) => ({
      role: message.role as Prompt.MessageEncoded['role'],
      content: message.content,
    }));

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
      requireConversationId: options?.requireConversationId,
      sequentialVisibility: options?.sequentialVisibility,
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
   * Get a pending pause request for a specific run.
   *
   * @param runId - The run identifier to check
   * @returns PendingPause if run is paused, null otherwise
   *
   * @example
   * const pause = await fred.getPendingPause('run-123');
   * if (pause) {
   *   console.log(`Awaiting: ${pause.prompt}`);
   *   if (pause.choices) {
   *     console.log(`Choices: ${pause.choices.join(', ')}`);
   *   }
   * }
   */
  async getPendingPause(runId: string): Promise<PendingPause | null> {
    const pauseManager = this.pipelineManager.getPauseManager();
    if (!pauseManager) {
      // No checkpoint manager configured = no pauses possible
      return null;
    }
    return pauseManager.getPendingPause(runId);
  }

  /**
   * List all pending pause requests across all runs.
   *
   * @returns Array of pending pauses, sorted by createdAt descending
   *
   * @example
   * const pauses = await fred.listPendingPauses();
   * for (const pause of pauses) {
   *   console.log(`Run ${pause.runId}: ${pause.prompt}`);
   * }
   */
  async listPendingPauses(): Promise<PendingPause[]> {
    const pauseManager = this.pipelineManager.getPauseManager();
    if (!pauseManager) {
      return [];
    }
    return pauseManager.listPendingPauses();
  }

  /**
   * Resume a paused pipeline with human input.
   *
   * The human input is merged into the conversation history as a USER message,
   * making it available to downstream pipeline steps.
   *
   * @param runId - The run identifier to resume
   * @param options - Human input and resume options
   * @returns Resume result with execution outcome
   * @throws If run is not found or not paused
   * @throws If input validation fails (when schema/choices specified)
   *
   * @example
   * // Resume with text input
   * const result = await fred.resume('run-123', {
   *   humanInput: 'approved',
   * });
   *
   * @example
   * // Resume with choice
   * const result = await fred.resume('run-123', {
   *   humanInput: 'approve', // Must be in pause.choices
   * });
   *
   * @example
   * // Override resume behavior
   * const result = await fred.resume('run-123', {
   *   humanInput: 'Modified prompt text',
   *   resumeBehavior: 'rerun', // Re-execute the paused step
   * });
   */
  async resume(
    runId: string,
    options: HumanInputResumeOptions
  ): Promise<ResumeResult> {
    return this.pipelineManager.resumeWithHumanInput(runId, options);
  }

  /**
   * Configure observability (tracing and logging) from config.
   * Builds Effect tracer and logger layers with OTLP exporter support.
   *
   * @param config - Observability configuration
   * @example
   * fred.configureObservability({
   *   otlp: { endpoint: 'http://localhost:4318/v1/traces' },
   *   logLevel: 'debug'
   * });
   */
  configureObservability(config: ObservabilityConfig): void {
    this.observabilityLayers = buildObservabilityLayers(config);
  }

  /**
   * Get the configured observability layers (if any).
   * Returns undefined if observability has not been configured.
   */
  getObservabilityLayers(): ObservabilityLayers | undefined {
    return this.observabilityLayers;
  }

  /**
   * Initialize from a config file
   */
  async initializeFromConfig(
    configPath: string,
    options?: {
      toolExecutors?: Map<string, Tool['execute']>;
      providers?: ProviderConfigInput;
    }
  ): Promise<void> {
    // Load and validate config
    const config = loadConfig(configPath);
    validateConfig(config);
    const defaultSystemMessage = config.defaultSystemMessage
      ? loadPromptFile(config.defaultSystemMessage, configPath, false)
      : undefined;
    this.agentManager.setDefaultSystemMessage(defaultSystemMessage);
    const memoryDefaults = config.memory;
    if (memoryDefaults?.policy) {
      this.contextManager.setDefaultPolicy(memoryDefaults.policy);
    }
    this.memoryDefaults = {
      policy: memoryDefaults?.policy,
      requireConversationId: memoryDefaults?.requireConversationId,
      sequentialVisibility: memoryDefaults?.sequentialVisibility,
    };

    // Configure persistence adapter
    if (config.persistence) {
      if (config.persistence.adapter === 'postgres') {
        const connectionString = process.env.FRED_POSTGRES_URL;
        if (!connectionString) {
          throw new Error(
            'FRED_POSTGRES_URL environment variable is required for Postgres persistence adapter'
          );
        }
        const storage = new PostgresContextStorage({ connectionString });
        this.contextManager.setStorage(storage);
      } else if (config.persistence.adapter === 'sqlite') {
        const path = process.env.FRED_SQLITE_PATH || './fred.db';
        const storage = new SqliteContextStorage({ path });
        this.contextManager.setStorage(storage);
      }

      // Set up checkpoint storage if persistence enabled (default: true)
      const checkpointEnabled = config.persistence.checkpoint?.enabled !== false;
      if (checkpointEnabled) {
        let checkpointStorage: CheckpointStorage;

        if (config.persistence.adapter === 'postgres') {
          const url = process.env.FRED_POSTGRES_URL;
          if (!url) {
            throw new Error('FRED_POSTGRES_URL required for postgres persistence');
          }
          checkpointStorage = new PostgresCheckpointStorage({ connectionString: url });
        } else {
          const dbPath = process.env.FRED_SQLITE_PATH ?? './fred.db';
          checkpointStorage = new SqliteCheckpointStorage({ path: dbPath });
        }

        const checkpointManager = new CheckpointManager({
          storage: checkpointStorage,
          defaultTtlMs: config.persistence.checkpoint?.ttlMs,
        });

        // Wire to pipeline manager
        this.pipelineManager.setCheckpointManager(checkpointManager);

        // Start cleanup task
        const cleanupIntervalMs = config.persistence.checkpoint?.cleanupIntervalMs ?? 3600000;
        const cleanupTask = new CheckpointCleanupTask(checkpointStorage, { intervalMs: cleanupIntervalMs });
        cleanupTask.start();

        // Note: Consider adding a shutdown() method to Fred that stops cleanup
      }
    }

    // Configure observability (tracing and logging)
    const observabilityConfig = extractObservability(config);
    this.configureObservability(observabilityConfig);

    // Register providers
    const providers = extractProviders(config);
    if (providers.length > 0) {
      await Promise.all(
        providers.map((pack) => this.providerRegistry.register(pack.package, pack.config))
      );
      this.providerRegistry.markInitialized();
      this.syncProviderRegistry();
    } else if (options?.providers) {
      await this.registerDefaultProviders(options.providers);
    } else {
      await this.loadDefaultProviders();
      this.providerRegistry.markInitialized();
      this.syncProviderRegistry();
    }

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

    // Configure routing if specified in config
    if (config.routing) {
      // Warn if defaultAgent references unknown agent
      if (config.routing.defaultAgent && !this.agentManager.hasAgent(config.routing.defaultAgent)) {
        console.warn(
          `[Config] Routing defaultAgent "${config.routing.defaultAgent}" not found among registered agents`
        );
      }
      this.configureRouting(config.routing);
    }

    // Configure workflows if specified in config
    const workflows = extractWorkflows(config);
    if (workflows.length > 0) {
      this.configureWorkflows(workflows);
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
// Note: MCPClientMetrics can be imported directly from './core/agent/factory' if needed
export * from './core/tool/tool';
export type { EffectProviderFactory } from './core/platform/base';
export * from './core/platform/provider';
export * from './config/types';
export { ToolRegistry } from './core/tool/registry';
export { AgentManager } from './core/agent/manager';
export { IntentMatcher } from './core/intent/matcher';
export { IntentRouter } from './core/intent/router';
export { ContextManager } from './core/context/manager';
export * from './core/context/context';
export { SqliteContextStorage } from './core/context/storage/sqlite';
export { PostgresContextStorage } from './core/context/storage/postgres';

// Checkpoint storage exports
export {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from './core/pipeline/checkpoint';
export type {
  CheckpointStorage,
  Checkpoint,
  CheckpointStatus,
  CheckpointManagerOptions,
  CheckpointCleanupOptions,
} from './core/pipeline/checkpoint';

// Pause types
export type {
  PauseSignal,
  PauseRequest,
  PendingPause,
  PauseMetadata,
  HumanInputResumeOptions,
} from './core/pipeline/pause/types';
export { createRequestHumanInputTool } from './core/pipeline/pause';
export { createCalculatorTool } from './core/tool/calculator';

export { HookManager } from './core/hooks/manager';
export * from './core/hooks/types';
export { MessageRouter } from './core/routing/router';
export * from './core/routing/types';
export { WorkflowManager } from './core/workflow/manager';
export { WorkflowContext } from './core/workflow/context';
export * from './core/workflow/types';
export * from './core/tracing';
export { NoOpTracer } from './core/tracing/noop-tracer';
export { createOpenTelemetryTracer, isOpenTelemetryAvailable } from './core/tracing/otel-exporter';
export * from './core/eval/golden-trace';
export { GoldenTraceRecorder } from './core/eval/recorder';
export * from './core/eval/assertions';
export * from './core/eval/assertion-runner';

// Observability exports
export { buildObservabilityLayers, annotateSpan, withFredSpan } from './core/observability/otel';
export type { ObservabilityLayers } from './core/observability/otel';
