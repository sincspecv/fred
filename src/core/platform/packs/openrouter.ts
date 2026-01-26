import { Effect } from 'effect';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

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
    // Dynamic import to avoid hard dependency
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<typeof import('@effect/ai-openai')>;
    const module = await dynamicImport('@effect/ai-openai');

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENROUTER_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];
    const apiUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';

    // Use OpenAiClient.layer or OpenAiLayer.layer based on package version
    // Note: @effect/ai-openai uses 'apiUrl' not 'baseUrl'
    const layer =
      module.OpenAiClient?.layer?.({
        apiKey,
        apiUrl,
        headers: config.headers,
      }) ??
      module.OpenAiLayer?.layer?.({
        apiKey,
        apiUrl,
        headers: config.headers,
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
            maxTokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default OpenRouterProviderFactory;
