import { Effect, Layer } from 'effect';
import type { LanguageModel } from '@effect/ai';
import { ProviderDefinition } from '../../../src/core/platform/provider';

export function createMockProvider(platform: string = 'openai'): ProviderDefinition {
  const mockModel = {
    provider: platform,
    modelId: 'gpt-4',
  } as LanguageModel;

  return {
    id: platform,
    aliases: [platform],
    config: {
      modelDefaults: {
        model: 'gpt-4',
      },
    },
    getModel: (modelId: string) => Effect.succeed({ ...mockModel, modelId } as LanguageModel),
    layer: Layer.empty,
  };
}

export function createMockAIProvider(platform?: string): ProviderDefinition {
  return createMockProvider(platform ?? 'openai');
}
