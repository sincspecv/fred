import { Effect } from 'effect';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

/**
 * Google (Gemini) provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const GoogleProviderFactory: EffectProviderFactory = {
  id: 'google',
  aliases: ['google', 'gemini'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<typeof import('@effect/ai-google')>;
    const module = await dynamicImport('@effect/ai-google');

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'GOOGLE_GENERATIVE_AI_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];

    // Use GoogleAiClient.layer for client initialization
    const layer = module.GoogleAiClient?.layer?.({
      apiKey,
      baseUrl: config.baseUrl,
      headers: config.headers,
    });

    if (!layer) {
      throw new Error('Google provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.GoogleLanguageModel?.model) {
          return Effect.fail(new Error('Google LanguageModel not available in provider pack'));
        }
        return Effect.succeed(
          module.GoogleLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            maxTokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default GoogleProviderFactory;
