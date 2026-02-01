import { Context, Effect, Layer } from 'effect';
import type * as AiModel from '@effect/ai/Model';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layer: Layer.Layer<any, any, any>;
}

export interface ProviderConfigInput {
  defaultModel?: string;
  modelDefaults?: ProviderModelDefaults;
  aliases?: Record<string, string>;
  providers?: ProviderRegistration[];
}

export const ProviderService = Context.GenericTag<ProviderService>('Fred.ProviderService');

export interface ProviderService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModel: (providerId: string, modelId?: string, overrides?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  listProviders: () => string[];
}
