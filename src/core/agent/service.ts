import { Context, Effect, Layer, Ref } from 'effect';
import type { AgentConfig, AgentInstance } from './agent';
import type { ProviderDefinition } from '../platform/provider';
import {
  AgentNotFoundError,
  AgentAlreadyExistsError,
  AgentCreationError,
  AgentExecutionError,
  type AgentError
} from './errors';
import { AgentFactory } from './factory';
import { ToolRegistryService } from '../tool/service';
import { ProviderRegistryService } from '../platform/service';
import type { Tracer } from '../tracing';

/**
 * AgentService interface for Effect-based agent lifecycle management
 */
export interface AgentService {
  /**
   * Create an agent from configuration
   */
  createAgent(config: AgentConfig): Effect.Effect<AgentInstance, AgentCreationError | AgentAlreadyExistsError>;

  /**
   * Get an agent by ID
   */
  getAgent(id: string): Effect.Effect<AgentInstance, AgentNotFoundError>;

  /**
   * Get an agent by ID (returns undefined if not found)
   */
  getAgentOptional(id: string): Effect.Effect<AgentInstance | undefined>;

  /**
   * Check if an agent exists
   */
  hasAgent(id: string): Effect.Effect<boolean>;

  /**
   * Remove an agent
   */
  removeAgent(id: string): Effect.Effect<boolean>;

  /**
   * Get all agents
   */
  getAllAgents(): Effect.Effect<AgentInstance[]>;

  /**
   * Clear all agents
   */
  clear(): Effect.Effect<void>;

  /**
   * Set the tracer for agent creation
   */
  setTracer(tracer?: Tracer): Effect.Effect<void>;

  /**
   * Set default system message for agents
   */
  setDefaultSystemMessage(systemMessage?: string): Effect.Effect<void>;

  /**
   * Set global variables resolver
   */
  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): Effect.Effect<void>;

  /**
   * Match agent by utterance
   */
  matchAgentByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Effect.Effect<{ agentId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null>;

  /**
   * Get MCP client connection metrics
   */
  getMCPMetrics(): Effect.Effect<any>;

  /**
   * Register shutdown hooks for MCP client cleanup
   */
  registerShutdownHooks(): Effect.Effect<void>;
}

export const AgentService = Context.GenericTag<AgentService>(
  'AgentService'
);

/**
 * Implementation of AgentService
 */
class AgentServiceImpl implements AgentService {
  private factory: AgentFactory;
  private defaultSystemMessage?: string;

  constructor(
    private agents: Ref.Ref<Map<string, AgentInstance>>,
    private toolRegistryService: typeof ToolRegistryService.Service,
    private providerRegistryService: typeof ProviderRegistryService.Service,
    private tracer?: Tracer
  ) {
    // AgentFactory is still used internally for actual agent creation logic
    // Full conversion of AgentFactory would be a separate task
    // For now, we need to create it with a ToolRegistry instance
    // We'll use a promise-based wrapper to get tools from the service
    const legacyToolRegistry = {
      registerTool: () => {},
      getTool: (id: string) => undefined,
      getTools: (ids: string[]) => [],
      getAllTools: () => [],
      hasTool: (id: string) => false,
      removeTool: (id: string) => false,
      clear: () => {},
      get size() { return 0; },
      normalizeTools: async (ids: string[]) => {
        // Get tools from service synchronously for AgentFactory
        const tools = await Effect.runPromise(
          toolRegistryService.normalizeTools(ids)
        );
        return tools;
      },
      toAISDKTools: async (ids: string[]) => {
        const tools = await Effect.runPromise(
          toolRegistryService.toAISDKTools(ids)
        );
        return tools;
      },
    };

    this.factory = new AgentFactory(legacyToolRegistry as any, tracer);
  }

  createAgent(config: AgentConfig): Effect.Effect<AgentInstance, AgentCreationError | AgentAlreadyExistsError> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);

      if (agents.has(config.id)) {
        return yield* Effect.fail(new AgentAlreadyExistsError({ id: config.id }));
      }

      // Get provider definition from registry
      const providerDef = yield* self.providerRegistryService.getDefinition(config.platform).pipe(
        Effect.mapError((error) => new AgentCreationError({
          id: config.id,
          cause: error
        }))
      );

      // Resolve config with default system message
      const resolvedConfig = {
        ...config,
        systemMessage: config.systemMessage ?? self.defaultSystemMessage,
      };

      // Create agent using factory
      const agentProcessor = yield* Effect.tryPromise({
        try: () => self.factory.createAgent(resolvedConfig, providerDef),
        catch: (error) => new AgentCreationError({
          id: config.id,
          cause: error
        })
      });

      const instance: AgentInstance = {
        id: config.id,
        config: resolvedConfig,
        processMessage: agentProcessor.processMessage,
        streamMessage: agentProcessor.streamMessage,
      } as AgentInstance;

      const newAgents = new Map(agents);
      newAgents.set(config.id, instance);
      yield* Ref.set(self.agents, newAgents);

      return instance;
    });
  }

  getAgent(id: string): Effect.Effect<AgentInstance, AgentNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const agent = agents.get(id);
      if (!agent) {
        return yield* Effect.fail(new AgentNotFoundError({ id }));
      }
      return agent;
    });
  }

  getAgentOptional(id: string): Effect.Effect<AgentInstance | undefined> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return agents.get(id);
    });
  }

  hasAgent(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return agents.has(id);
    });
  }

  removeAgent(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const newAgents = new Map(agents);
      const result = newAgents.delete(id);
      yield* Ref.set(self.agents, newAgents);

      // Clean up MCP clients for this agent
      yield* Effect.promise(() => self.factory.cleanupMCPClients(id));

      return result;
    });
  }

  getAllAgents(): Effect.Effect<AgentInstance[]> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return Array.from(agents.values());
    });
  }

  clear(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Ref.set(self.agents, new Map());
      yield* Effect.promise(() => self.factory.cleanupAllMCPClients());
    });
  }

  setTracer(tracer?: Tracer): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.tracer = tracer;
      self.factory.setTracer(tracer);
    });
  }

  setDefaultSystemMessage(systemMessage?: string): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.defaultSystemMessage = systemMessage;
      self.factory.setDefaultSystemMessage(systemMessage);
    });
  }

  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setGlobalVariablesResolver(resolver);
    });
  }

  matchAgentByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Effect.Effect<{ agentId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const normalizedMessage = message.toLowerCase().trim();

      // Get all agents with utterances
      const agentsWithUtterances = Array.from(agents.values()).filter(
        agent => agent.config.utterances && agent.config.utterances.length > 0
      );

      // Try exact match first
      for (const agent of agentsWithUtterances) {
        const utterances = agent.config.utterances!;
        for (const utterance of utterances) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            return {
              agentId: agent.id,
              confidence: 1.0,
              matchType: 'exact' as const,
            };
          }
        }
      }

      // Try regex match
      for (const agent of agentsWithUtterances) {
        const utterances = agent.config.utterances!;
        for (const utterance of utterances) {
          try {
            const regex = new RegExp(utterance, 'i');
            if (regex.test(message)) {
              return {
                agentId: agent.id,
                confidence: 0.8,
                matchType: 'regex' as const,
              };
            }
          } catch {
            // Invalid regex, skip
            continue;
          }
        }
      }

      // Try semantic matching if provided
      if (semanticMatcher) {
        for (const agent of agentsWithUtterances) {
          const utterances = agent.config.utterances!;
          const result = yield* Effect.promise(() => semanticMatcher(message, utterances));
          if (result.matched) {
            return {
              agentId: agent.id,
              confidence: result.confidence,
              matchType: 'semantic' as const,
            };
          }
        }
      }

      return null;
    });
  }

  getMCPMetrics(): Effect.Effect<any> {
    const self = this;
    return Effect.sync(() => self.factory.getMCPMetrics());
  }

  registerShutdownHooks(): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.registerShutdownHooks();
    });
  }
}

/**
 * Live layer providing AgentService with dependencies on ToolRegistryService and ProviderRegistryService
 */
export const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const agents = yield* Ref.make(new Map<string, AgentInstance>());
    const toolRegistryService = yield* ToolRegistryService;
    const providerRegistryService = yield* ProviderRegistryService;
    return new AgentServiceImpl(agents, toolRegistryService, providerRegistryService);
  })
);
