import { Effect } from 'effect';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

/**
 * Groq provider pack factory.
 * Uses OpenAI-compatible API via @effect/ai-openai with Groq's baseUrl.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const GroqProviderFactory: EffectProviderFactory = {
  id: 'groq',
  aliases: ['groq'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<typeof import('@effect/ai-openai')>;
    const module = await dynamicImport('@effect/ai-openai');

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'GROQ_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];
    const baseUrl = config.baseUrl ?? 'https://api.groq.com/openai/v1';

    // Use OpenAiClient.layer or OpenAiLayer.layer based on package version
    const layer =
      module.OpenAiClient?.layer?.({
        apiKey,
        baseUrl,
        headers: config.headers,
      }) ??
      module.OpenAiLayer?.layer?.({
        apiKey,
        baseUrl,
        headers: config.headers,
      });

    if (!layer) {
      throw new Error('Groq provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenAiLanguageModel?.model) {
          return Effect.fail(new Error('Groq LanguageModel not available in provider pack'));
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

export default GroqProviderFactory;
