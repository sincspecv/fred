import { AgentConfig, AgentInstance } from './agent';
import { AgentFactory } from './factory';
import { ProviderDefinition } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { semanticMatch } from '../../utils/semantic';
import { Tracer } from '../tracing';

/**
 * Agent manager for lifecycle management
 */
export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  private factory: AgentFactory;
  private providers: Map<string, ProviderDefinition> = new Map();
  private tracer?: Tracer;
  private defaultSystemMessage?: string;

  constructor(toolRegistry: ToolRegistry, tracer?: Tracer) {
    this.tracer = tracer;
    this.factory = new AgentFactory(toolRegistry, tracer);
    // Set up handoff handler for agent-to-agent transfers
    this.factory.setHandoffHandler({
      getAgent: (id: string) => this.getAgent(id),
      getAvailableAgents: () => this.getAllAgents().map(a => a.id),
    });
  }

  /**
   * Set the tracer for agent creation
   * Note: This only affects newly created agents
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
    this.factory.setTracer(tracer);
  }

  setDefaultSystemMessage(systemMessage?: string): void {
    this.defaultSystemMessage = systemMessage;
    this.factory.setDefaultSystemMessage(systemMessage);
  }

  /**
   * Set the global variables resolver for injecting context into agent prompts
   */
  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): void {
    this.factory.setGlobalVariablesResolver(resolver);
  }

  /**
   * Get MCP client connection metrics
   */
  getMCPMetrics() {
    return this.factory.getMCPMetrics();
  }

  /**
   * Register shutdown hooks for MCP client cleanup
   */
  registerShutdownHooks(): void {
    this.factory.registerShutdownHooks();
  }

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: ProviderDefinition): void {
    this.providers.set(platform, provider);
  }

  /**
   * List registered provider IDs
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get a provider for a platform
   */
  private getProvider(platform: string): ProviderDefinition {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`No provider registered for platform: ${platform}`);
    }
    return provider;
  }

  /**
   * Create an agent from configuration
   */
  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent with id "${config.id}" already exists`);
    }

    const resolvedConfig = {
      ...config,
      systemMessage: config.systemMessage ?? this.defaultSystemMessage,
    };
    const provider = this.getProvider(config.platform);
    const agentProcessor = await this.factory.createAgent(resolvedConfig, provider);

    const instance: AgentInstance = {
      id: config.id,
      config: resolvedConfig,
      // Store the processor functions
      processMessage: agentProcessor.processMessage,
      streamMessage: agentProcessor.streamMessage,
    } as AgentInstance;

    this.agents.set(config.id, instance);
    return instance;
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.agents.get(id);
  }

  /**
   * Check if an agent exists
   */
  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * Remove an agent
   * Also cleans up associated MCP clients to prevent memory leaks
   */
  async removeAgent(id: string): Promise<boolean> {
    const removed = this.agents.delete(id);
    if (removed) {
      // Clean up MCP clients for this agent
      await this.factory.cleanupMCPClients(id);
    }
    return removed;
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Clear all agents
   * Also cleans up all MCP clients to prevent memory leaks
   */
  async clear(): Promise<void> {
    this.agents.clear();
    await this.factory.cleanupAllMCPClients();
  }

  /**
   * Match a message against agent utterances
   * Returns the matching agent ID if found, null otherwise
   * Uses the same hybrid strategy as IntentMatcher: exact → regex → semantic
   */
  async matchAgentByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Promise<{ agentId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null> {
    const normalizedMessage = message.toLowerCase().trim();

    // Get all agents with utterances
    const agentsWithUtterances = Array.from(this.agents.values()).filter(
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
            matchType: 'exact',
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
              matchType: 'regex',
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
        const result = await semanticMatcher(message, utterances);
        if (result.matched) {
          return {
            agentId: agent.id,
            confidence: result.confidence,
            matchType: 'semantic',
          };
        }
      }
    }

    return null;
  }
}
