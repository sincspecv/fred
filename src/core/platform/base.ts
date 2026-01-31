import { Effect, Layer } from 'effect';
import type { LanguageModel } from '@effect/ai';
import { ProviderConfig, ProviderDefinition, ProviderModelDefaults } from './provider';
import { validatePackExports, isProviderFactory } from './pack-schema';
import { ProviderPackLoadError, ProviderRegistrationError } from './errors';

// Re-export validation utilities for external use
export { validatePackExports, isProviderFactory } from './pack-schema';
export { ProviderPackLoadError, ProviderNotFoundError, ProviderRuntimeError } from './errors';

export interface EffectProviderFactory {
  id: string;
  aliases?: string[];
  load: (config: ProviderConfig) => Promise<{
    layer: Layer.Layer<never, Error>;
    getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<LanguageModel, Error>;
  }>;
}

/**
 * Symbol to mark factories that have already been validated.
 * Prevents redundant validation on repeated calls.
 */
const VALIDATED_FACTORY = Symbol('ValidatedFactory');

interface ValidatedFactory extends EffectProviderFactory {
  [VALIDATED_FACTORY]: true;
}

/**
 * Check if a factory has already been validated.
 */
function isAlreadyValidated(factory: EffectProviderFactory): factory is ValidatedFactory {
  return VALIDATED_FACTORY in factory;
}

/**
 * Mark a factory as validated.
 */
function markValidated(factory: EffectProviderFactory): ValidatedFactory {
  (factory as ValidatedFactory)[VALIDATED_FACTORY] = true;
  return factory as ValidatedFactory;
}

/**
 * Create a ProviderDefinition from an EffectProviderFactory.
 *
 * Validates the factory structure before use and wraps load() failures
 * in ProviderPackLoadError with clear remediation hints.
 *
 * @param factory - The provider factory (from pack or built-in)
 * @param config - Provider configuration
 * @returns Promise<ProviderDefinition> on success
 * @throws ProviderPackLoadError if factory validation or load() fails
 */
export async function createProviderDefinition(
  factory: EffectProviderFactory,
  config: ProviderConfig
): Promise<ProviderDefinition> {
  // Validate factory structure if not already validated
  const validatedFactory = isAlreadyValidated(factory)
    ? factory
    : markValidated(validatePackExports(factory, factory.id ?? 'unknown'));

  // Wrap load() call in try/catch to provide helpful error context
  let loadResult: { layer: Layer.Layer<never, Error>; getModel: EffectProviderFactory['load'] extends (config: ProviderConfig) => Promise<infer R> ? R extends { getModel: infer G } ? G : never : never };

  try {
    loadResult = await validatedFactory.load(config);
  } catch (error) {
    // If it's already a ProviderPackLoadError, preserve it
    if (error instanceof ProviderPackLoadError) {
      throw error;
    }

    // Wrap unknown errors in ProviderPackLoadError
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderPackLoadError({
      packageName: validatedFactory.id,
      reason: `Provider load() failed: ${message}`,
      remediation: [
        'Check the provider pack configuration:',
        '  - Is the API key environment variable set?',
        '  - Is the baseUrl correct (if specified)?',
        '  - Are required dependencies installed?',
      ].join('\n'),
      cause: error,
    });
  }

  return {
    id: validatedFactory.id,
    aliases: validatedFactory.aliases ?? [],
    config,
    getModel: loadResult.getModel,
    layer: loadResult.layer,
  };
}

/**
 * Effect-based version of createProviderDefinition.
 *
 * Returns an Effect with proper error channel instead of throwing.
 */
export const createProviderDefinitionEffect = (
  factory: EffectProviderFactory,
  config: ProviderConfig
): Effect.Effect<ProviderDefinition, ProviderRegistrationError> => {
  // Validate factory structure
  const validateFactory = Effect.try({
    try: () => {
      if (isAlreadyValidated(factory)) {
        return factory;
      }
      return markValidated(validatePackExports(factory, factory.id ?? 'unknown'));
    },
    catch: (error) => new ProviderRegistrationError({
      providerId: factory.id ?? 'unknown',
      cause: error
    })
  });

  return Effect.gen(function* () {
    const validatedFactory = yield* validateFactory;

    // Load the provider
    const loadResult = yield* Effect.tryPromise({
      try: () => validatedFactory.load(config),
      catch: (error) => {
        if (error instanceof ProviderPackLoadError) {
          return new ProviderRegistrationError({
            providerId: validatedFactory.id,
            cause: error
          });
        }
        const message = error instanceof Error ? error.message : String(error);
        return new ProviderRegistrationError({
          providerId: validatedFactory.id,
          cause: new Error(`Provider load() failed: ${message}`)
        });
      }
    });

    return {
      id: validatedFactory.id,
      aliases: validatedFactory.aliases ?? [],
      config,
      getModel: loadResult.getModel,
      layer: loadResult.layer,
    };
  });
};
