import { Context, Effect, Layer, Ref } from 'effect';
import type { LanguageModel } from '@effect/ai';
import type { ProviderDefinition, ProviderConfig, ProviderModelDefaults } from './provider';
import type { EffectProviderFactory } from './base';
import { ProviderNotFoundError, ProviderRegistrationError, ProviderModelError } from './errors';
import { loadProviderPack } from './loader';
import { createProviderDefinition } from './base';

/**
 * ProviderRegistryService interface for Effect-based provider management
 */
export interface ProviderRegistryService {
  /**
   * Register a provider pack by id/package name
   * Loads the pack dynamically and validates exports
   */
  register(idOrPackage: string, config?: ProviderConfig): Effect.Effect<void, ProviderRegistrationError>;

  /**
   * Register a pre-created factory (for programmatic use)
   */
  registerFactory(factory: EffectProviderFactory, config?: ProviderConfig): Effect.Effect<void, ProviderRegistrationError>;

  /**
   * Register a pre-built provider definition directly
   */
  registerDefinition(definition: ProviderDefinition): Effect.Effect<void>;

  /**
   * Get a model from a registered provider
   */
  getModel(
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
  ): Effect.Effect<LanguageModel, ProviderNotFoundError | ProviderModelError>;

  /**
   * List unique provider IDs (not aliases)
   */
  listProviders(): Effect.Effect<string[]>;

  /**
   * Get a provider definition by id or alias
   */
  getDefinition(id: string): Effect.Effect<ProviderDefinition, ProviderNotFoundError>;

  /**
   * Get all unique provider definitions
   */
  getDefinitions(): Effect.Effect<ProviderDefinition[]>;

  /**
   * Check if a provider is registered
   */
  hasProvider(id: string): Effect.Effect<boolean>;

  /**
   * Get merged Effect Layer for all providers
   */
  getLayer(): Effect.Effect<Layer.Layer<never, Error>>;

  /**
   * Mark registry as initialized (after startup loading)
   */
  markInitialized(): Effect.Effect<void>;

  /**
   * Check if registry is initialized
   */
  isInitialized(): Effect.Effect<boolean>;
}

export const ProviderRegistryService = Context.GenericTag<ProviderRegistryService>(
  'ProviderRegistryService'
);

/**
 * Implementation of ProviderRegistryService
 */
class ProviderRegistryServiceImpl implements ProviderRegistryService {
  constructor(
    private providers: Ref.Ref<Map<string, ProviderDefinition>>,
    private initialized: Ref.Ref<boolean>
  ) {}

  register(idOrPackage: string, config: ProviderConfig = {}): Effect.Effect<void, ProviderRegistrationError> {
    const self = this;
    return Effect.gen(function* () {
      const factory = yield* Effect.tryPromise({
        try: () => loadProviderPack(idOrPackage),
        catch: (error) => new ProviderRegistrationError({
          providerId: idOrPackage,
          cause: error
        })
      });

      const definition = yield* Effect.tryPromise({
        try: () => createProviderDefinition(factory, config),
        catch: (error) => new ProviderRegistrationError({
          providerId: idOrPackage,
          cause: error
        })
      });

      yield* self.registerDefinition(definition);
    });
  }

  registerFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Effect.Effect<void, ProviderRegistrationError> {
    const self = this;
    return Effect.gen(function* () {
      const definition = yield* Effect.tryPromise({
        try: () => createProviderDefinition(factory, config),
        catch: (error) => new ProviderRegistrationError({
          providerId: factory.id,
          cause: error
        })
      });

      yield* self.registerDefinition(definition);
    });
  }

  registerDefinition(definition: ProviderDefinition): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const newProviders = new Map(providers);
      newProviders.set(definition.id, definition);
      for (const alias of definition.aliases) {
        newProviders.set(alias, definition);
      }
      yield* Ref.set(self.providers, newProviders);
    });
  }

  getModel(
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
  ): Effect.Effect<LanguageModel, ProviderNotFoundError | ProviderModelError> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const definition = providers.get(providerId.toLowerCase());

      if (!definition) {
        return yield* Effect.fail(new ProviderNotFoundError({
          providerId,
          availableProviders: yield* self.listProviders(),
          suggestion: self.findClosestMatch(providerId, providers)
        }));
      }

      const selectedModel = modelId ?? definition.config.modelDefaults?.model;
      if (!selectedModel) {
        return yield* Effect.fail(new ProviderModelError({
          providerId,
          modelId: 'undefined',
          cause: new Error(`No model configured for provider ${providerId}`)
        }));
      }

      const merged = { ...definition.config.modelDefaults, ...overrides };

      // definition.getModel returns Effect<LanguageModel, Error>
      return yield* definition.getModel(selectedModel, merged).pipe(
        Effect.mapError((error) => new ProviderModelError({
          providerId,
          modelId: selectedModel,
          cause: error
        }))
      );
    });
  }

  listProviders(): Effect.Effect<string[]> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const unique = new Set(
        Array.from(providers.values()).map((def) => def.id)
      );
      return Array.from(unique);
    });
  }

  getDefinition(id: string): Effect.Effect<ProviderDefinition, ProviderNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const definition = providers.get(id.toLowerCase());
      if (!definition) {
        return yield* Effect.fail(new ProviderNotFoundError({
          providerId: id,
          availableProviders: yield* self.listProviders(),
          suggestion: self.findClosestMatch(id, providers)
        }));
      }
      return definition;
    });
  }

  getDefinitions(): Effect.Effect<ProviderDefinition[]> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      return Array.from(new Set(providers.values()));
    });
  }

  hasProvider(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      return providers.has(id.toLowerCase());
    });
  }

  getLayer(): Effect.Effect<Layer.Layer<never, Error>> {
    const self = this;
    return Effect.gen(function* () {
      const definitions = yield* self.getDefinitions();
      return definitions.reduce(
        (acc, definition) => Layer.merge(acc, definition.layer),
        Layer.empty as Layer.Layer<never, Error>
      );
    });
  }

  markInitialized(): Effect.Effect<void> {
    return Ref.set(this.initialized, true);
  }

  isInitialized(): Effect.Effect<boolean> {
    return Ref.get(this.initialized);
  }

  private findClosestMatch(input: string, providers: Map<string, ProviderDefinition>): string | undefined {
    const lower = input.toLowerCase();
    const ids = Array.from(new Set(Array.from(providers.values()).map(d => d.id)));
    return ids.find(
      (id) => id.toLowerCase().startsWith(lower) || id.toLowerCase().includes(lower)
    );
  }
}

/**
 * Live layer providing ProviderRegistryService
 */
export const ProviderRegistryServiceLive = Layer.effect(
  ProviderRegistryService,
  Effect.gen(function* () {
    const providers = yield* Ref.make(new Map<string, ProviderDefinition>());
    const initialized = yield* Ref.make(false);
    return new ProviderRegistryServiceImpl(providers, initialized);
  })
);
