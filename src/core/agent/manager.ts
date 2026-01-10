import { AgentConfig, AgentInstance } from './agent';
import { AgentFactory } from './factory';
import { AIProvider } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { semanticMatch } from '../../utils/semantic';

/**
 * Agent manager for lifecycle management
 */
export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  private factory: AgentFactory;
  private providers: Map<string, AIProvider> = new Map();

  constructor(toolRegistry: ToolRegistry) {
    this.factory = new AgentFactory(toolRegistry);
  }

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: AIProvider): void {
    this.providers.set(platform, provider);
  }

  /**
   * Get a provider for a platform
   */
  private getProvider(platform: string): AIProvider {
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

    const provider = this.getProvider(config.platform);
    const agentProcessor = await this.factory.createAgent(config, provider);

    const instance: AgentInstance = {
      id: config.id,
      config,
      // Store the processor function
      processMessage: agentProcessor.processMessage,
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
   */
  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.clear();
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


