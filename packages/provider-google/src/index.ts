import { Effect, Redacted } from 'effect';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import { registerBuiltinPack } from '@fred/core';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fred/core';

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
    let module: typeof import('@effect/ai-google');
    try {
      module = await import('@effect/ai-google');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-google. Install it with: bun add @effect/ai-google`
      );
    }

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'GOOGLE_GENERATIVE_AI_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;

    const transformClient = config.headers
      ? (client: HttpClient.HttpClient) =>
          client.pipe(
            HttpClient.mapRequest((request) =>
              Object.entries(config.headers ?? {}).reduce(
                (next, [key, value]) => HttpClientRequest.setHeader(key, value)(next),
                request
              )
            )
          )
      : undefined;

    // Use GoogleClient.layer for client initialization
    const layer = module.GoogleClient?.layer?.({
      apiKey,
      apiUrl: config.baseUrl,
      transformClient,
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
        // Config structure follows GenerateContentRequest schema with generationConfig nested
        return Effect.succeed(
          module.GoogleLanguageModel.model(modelId, {
            generationConfig: {
              temperature: overrides?.temperature,
              maxOutputTokens: overrides?.maxTokens,
            },
          } as any)
        );
      },
    };
  },
};

// Auto-register when imported
registerBuiltinPack(GoogleProviderFactory);

export { GoogleProviderFactory as googlePack };
export default GoogleProviderFactory;
