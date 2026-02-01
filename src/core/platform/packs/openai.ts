import { Effect, Redacted } from 'effect';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

/**
 * OpenAI provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const OpenAiProviderFactory: EffectProviderFactory = {
  id: 'openai',
  aliases: ['openai'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency
    // Use standard dynamic import instead of Function constructor
    let module: typeof import('@effect/ai-openai');
    try {
      module = await import('@effect/ai-openai');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-openai. Install it with: bun add @effect/ai-openai`
      );
    }

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENAI_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;

    // Use OpenAiClient.layer for client initialization
    const layer = module.OpenAiClient?.layer?.({
      apiKey,
      apiUrl: config.baseUrl,
    });

    if (!layer) {
      throw new Error('OpenAI provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenAiLanguageModel?.model) {
          return Effect.fail(new Error('OpenAI LanguageModel not available in provider pack'));
        }
        return Effect.succeed(
          module.OpenAiLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_output_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default OpenAiProviderFactory;
