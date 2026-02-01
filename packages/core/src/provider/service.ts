import { Context } from 'effect';
import type {
  ProviderConfig,
  ProviderConfigInput,
  ProviderDefinition,
  ProviderModelDefaults,
} from '../platform/provider';
import type { EffectProviderFactory } from '../platform/base';
import type { ProviderRegistry } from '../platform/registry';
import type { AgentManager } from '../agent/manager';
import { BUILTIN_PACKS } from '../platform/packs';

/**
 * Service for managing AI provider registration and configuration.
 * Handles provider packs, factories, and synchronization with the agent manager.
 */
export class ProviderService {
  constructor(
    private providerRegistry: ProviderRegistry,
    private agentManager: AgentManager
  ) {}

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: ProviderDefinition): void {
    this.providerRegistry.registerDefinition(provider);
    this.agentManager.registerProvider(platform, provider);
  }

  /**
   * Sync all registered providers to the agent manager
   */
  syncProviderRegistry(): void {
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
    return this.providerRegistry.listProviders();
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(providerId: string): boolean {
    return this.providerRegistry.hasProvider(providerId);
  }

  /**
   * Use an AI provider (fluent API)
   * Accepts provider configuration compatible with Effect provider packs
   * @param platform - Platform name ('openai', 'anthropic', 'google', etc.)
   * @param config - Provider configuration (API key env var name, base URL, headers)
   * @returns The provider instance
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

  /**
   * Load default providers from built-in packs
   */
  async loadDefaultProviders(): Promise<void> {
    for (const [id, factory] of Object.entries(BUILTIN_PACKS)) {
      try {
        await this.providerRegistry.registerFactory(factory, {});
      } catch (error) {
        console.debug(`Built-in provider ${id} not available:`, error);
      }
    }
  }
}

/**
 * Effect service tag for ProviderService
 */
export const ProviderServiceTag = Context.GenericTag<ProviderService>('ProviderService');
