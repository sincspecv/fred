import { Context, Effect, Layer } from 'effect';
import type { LanguageModel } from '@effect/ai';

export type ProviderAlias = string;

export interface ProviderModelDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  apiKeyEnvVar?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  modelDefaults?: ProviderModelDefaults;
  aliases?: ProviderAlias[];
  [key: string]: unknown;
}

export interface ProviderRegistration {
  id: string;
  config?: ProviderConfig;
  modelDefaults?: ProviderModelDefaults;
  aliases?: ProviderAlias[];
}

export interface ProviderDefinition {
  id: string;
  aliases: ProviderAlias[];
  config: ProviderConfig;
  getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<LanguageModel, Error>;
  layer: Layer.Layer<never, Error>;
}

export interface ProviderConfigInput {
  defaultModel?: string;
  modelDefaults?: ProviderModelDefaults;
  aliases?: Record<string, string>;
  providers?: ProviderRegistration[];
}

export const ProviderService = Context.GenericTag<ProviderService>('Fred.ProviderService');

export interface ProviderService {
  getModel: (providerId: string, modelId?: string, overrides?: ProviderModelDefaults) => Effect.Effect<LanguageModel, Error>;
  listProviders: () => string[];
}
