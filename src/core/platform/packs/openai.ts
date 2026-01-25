import { Effect } from 'effect';
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
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<typeof import('@effect/ai-openai')>;
    const module = await dynamicImport('@effect/ai-openai');

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENAI_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];

    // Use OpenAiClient.layer or OpenAiLayer.layer based on package version
    const layer =
      module.OpenAiClient?.layer?.({
        apiKey,
        baseUrl: config.baseUrl,
        headers: config.headers,
      }) ??
      module.OpenAiLayer?.layer?.({
        apiKey,
        baseUrl: config.baseUrl,
        headers: config.headers,
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
            maxTokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default OpenAiProviderFactory;
