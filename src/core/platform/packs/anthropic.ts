import { Effect } from 'effect';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

/**
 * Anthropic provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const AnthropicProviderFactory: EffectProviderFactory = {
  id: 'anthropic',
  aliases: ['anthropic'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<typeof import('@effect/ai-anthropic')>;
    const module = await dynamicImport('@effect/ai-anthropic');

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];

    // Use AnthropicClient.layer for client initialization
    const layer = module.AnthropicClient?.layer?.({
      apiKey,
      baseUrl: config.baseUrl,
      headers: config.headers,
    });

    if (!layer) {
      throw new Error('Anthropic provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.AnthropicLanguageModel?.model) {
          return Effect.fail(new Error('Anthropic LanguageModel not available in provider pack'));
        }
        return Effect.succeed(
          module.AnthropicLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            maxTokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default AnthropicProviderFactory;
