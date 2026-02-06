import { Effect, Redacted } from 'effect';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

/**
 * OpenRouter provider pack factory.
 * Uses OpenAI-compatible API via @effect/ai-openai with OpenRouter's baseUrl.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const OpenRouterProviderFactory: EffectProviderFactory = {
  id: 'openrouter',
  aliases: ['openrouter'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency (uses OpenAI-compatible API)
    let module: typeof import('@effect/ai-openai');
    try {
      module = await import('@effect/ai-openai');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-openai. Install it with: bun add @effect/ai-openai`
      );
    }

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENROUTER_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;
    const apiUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';

    // Use OpenAiClient.layer for client initialization
    const layer = module.OpenAiClient?.layer?.({
      apiKey,
      apiUrl,
    });

    if (!layer) {
      throw new Error('OpenRouter provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenAiLanguageModel?.model) {
          return Effect.fail(new Error('OpenRouter LanguageModel not available in provider pack'));
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

// Auto-register when imported
registerBuiltinPack(OpenRouterProviderFactory);

export { OpenRouterProviderFactory as openrouterPack };
export default OpenRouterProviderFactory;
