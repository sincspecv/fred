import { Effect, Redacted } from 'effect';
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
    // Use standard dynamic import instead of Function constructor
    let module: typeof import('@effect/ai-anthropic');
    try {
      module = await import('@effect/ai-anthropic');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-anthropic. Install it with: bun add @effect/ai-anthropic`
      );
    }

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'ANTHROPIC_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;

    // Use AnthropicClient.layer for client initialization
    const layer = module.AnthropicClient?.layer?.({
      apiKey,
      apiUrl: config.baseUrl,
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
            max_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

export default AnthropicProviderFactory;
