import { Effect, Layer } from 'effect';
import type * as AiModel from '@effect/ai/Model';
import { ProviderDefinition, ProviderConfig, ProviderModelDefaults } from './provider';
import { EffectProviderFactory, createProviderDefinition } from './base';
import { loadProviderPack } from './loader';
import { ProviderNotFoundError } from './errors';

export class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>();
  private initialized = false;

  /**
   * Register a provider pack by id/package name.
   * Loads the pack and validates exports.
   */
  async register(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    const factory = await loadProviderPack(idOrPackage);
    const definition = await createProviderDefinition(factory, config);
    this.registerDefinition(definition);
  }

  /**
   * Register a pre-created factory (for programmatic use).
   */
  async registerFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    const definition = await createProviderDefinition(factory, config);
    this.registerDefinition(definition);
  }

  /**
   * Register a pre-built provider definition.
   */
  registerDefinition(definition: ProviderDefinition): void {
    this.providers.set(definition.id, definition);
    for (const alias of definition.aliases) {
      this.providers.set(alias, definition);
    }
  }

  /**
   * Get a model from a registered provider.
   */
  getModel(
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Effect.Effect<AiModel.Model<any, any, any>, Error> {
    const definition = this.providers.get(providerId.toLowerCase());

    if (!definition) {
      return Effect.fail(new ProviderNotFoundError({
        providerId,
        availableProviders: this.listProviders(),
        suggestion: this.findClosestMatch(providerId),
      }));
    }

    const selectedModel = modelId ?? definition.config.modelDefaults?.model;
    if (!selectedModel) {
      return Effect.fail(new Error(`No model configured for provider ${providerId}`));
    }

    const merged = { ...definition.config.modelDefaults, ...overrides };
    return definition.getModel(selectedModel, merged);
  }

  /**
   * List unique provider IDs (not aliases).
   */
  listProviders(): string[] {
    const unique = new Set(
      Array.from(this.providers.values()).map((definition) => definition.id)
    );
    return Array.from(unique);
  }

  /**
   * Get a provider definition by id or alias.
   */
  getDefinition(id: string): ProviderDefinition | undefined {
    return this.providers.get(id.toLowerCase());
  }

  /**
   * List unique provider definitions (not aliases).
   */
  getDefinitions(): ProviderDefinition[] {
    return Array.from(new Set(this.providers.values()));
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }

  /**
   * Get merged Effect Layer for all providers.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayer(): Layer.Layer<any, any, any> {
    const definitions = Array.from(new Set(this.providers.values()));
    return definitions.reduce(
      (acc, definition) => Layer.merge(acc, definition.layer),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Layer.empty as unknown as Layer.Layer<any, any, any>
    );
  }

  /**
   * Mark registry as initialized (after startup loading).
   */
  markInitialized(): void {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private findClosestMatch(input: string): string | undefined {
    const lower = input.toLowerCase();
    const ids = this.listProviders();
    return ids.find(
      (id) => id.toLowerCase().startsWith(lower) || id.toLowerCase().includes(lower)
    );
  }
}
