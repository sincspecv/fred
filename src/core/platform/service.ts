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
