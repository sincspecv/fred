import { Effect, Layer } from 'effect';
import { ProviderConfig, ProviderDefinition, ProviderModelDefaults } from './provider';
import { createProviderDefinition } from './base';
import { loadProviderPack } from './loader';
import { ProviderNotFoundError } from './errors';

/**
 * Default aliases for convenience provider naming.
 */
const DEFAULT_ALIASES: Record<string, string> = {
  'prod-openai': 'openai',
  'dev-openai': 'openai',
  'prod-anthropic': 'anthropic',
  'prod-google': 'google',
};

function normalizeProviderId(id: string): string {
  return id.trim().toLowerCase();
}

function resolveAlias(id: string, aliases: Record<string, string>): string {
  return aliases[normalizeProviderId(id)] ?? normalizeProviderId(id);
}

function mergeConfigDefaults(config: ProviderConfig, defaults?: ProviderModelDefaults): ProviderConfig {
  if (!defaults) {
    return config;
  }

  return {
    ...config,
    modelDefaults: {
      ...defaults,
      ...config.modelDefaults,
    },
  };
}

/**
 * Create a provider definition by loading and initializing a pack.
 *
 * @param providerId - Provider ID or alias
 * @param config - Provider configuration
 * @param options - Optional aliases and defaults
 * @returns The initialized provider definition
 * @throws ProviderPackLoadError if the pack cannot be loaded or initialized
 */
export async function createDynamicProvider(
  providerId: string,
  config: ProviderConfig = {},
  options?: {
    aliases?: Record<string, string>;
    defaults?: ProviderModelDefaults;
  }
): Promise<ProviderDefinition> {
  // Resolve alias
  const aliasMap = { ...DEFAULT_ALIASES, ...(options?.aliases ?? {}) };
  const resolvedId = resolveAlias(providerId, aliasMap);
  const providerConfig = mergeConfigDefaults(config, options?.defaults);

  // Load pack (throws on failure)
  const factory = await loadProviderPack(resolvedId);

  // Create definition (throws on failure)
  return createProviderDefinition(factory, providerConfig);
}

/**
 * Find closest matching provider ID for typo suggestions.
 *
 * @param input - The input provider ID that wasn't found
 * @param candidates - List of available provider IDs
 * @returns The closest match, if any
 */
function findClosestMatch(input: string, candidates: string[]): string | undefined {
  const lower = input.toLowerCase();
  // Try prefix match first
  const prefixMatch = candidates.find((c) => c.toLowerCase().startsWith(lower));
  if (prefixMatch) return prefixMatch;
  // Try substring match
  const substringMatch = candidates.find((c) => c.toLowerCase().includes(lower));
  return substringMatch;
}

/**
 * Build a provider service from loaded provider definitions.
 *
 * @param definitions - Array of loaded provider definitions
 * @returns Object with layer, getModel, and listProviders
 */
export function buildProviderService(definitions: ProviderDefinition[]): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layer: Layer.Layer<any, any, any>;
  getModel: (
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<any, Error | ProviderNotFoundError>;
  listProviders: () => string[];
} {
  const providerMap = new Map<string, ProviderDefinition>();
  for (const definition of definitions) {
    providerMap.set(definition.id, definition);
    for (const alias of definition.aliases) {
      providerMap.set(alias, definition);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = definitions.reduce<Layer.Layer<any, any, any>>(
    (acc, definition) => Layer.merge(acc, definition.layer),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Layer.empty as unknown as Layer.Layer<any, any, any>
  );

  const listProviders = () =>
    Array.from(new Set(definitions.map((definition) => definition.id)));

  const getModel = (
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
  ) => {
    const resolved = resolveAlias(providerId, DEFAULT_ALIASES);
    const definition = providerMap.get(resolved);
    if (!definition) {
      const available = listProviders();
      return Effect.fail(
        new ProviderNotFoundError({
          providerId,
          availableProviders: available,
          suggestion: findClosestMatch(providerId, available),
        })
      );
    }

    const selectedModel = modelId ?? definition.config.modelDefaults?.model;
    if (!selectedModel) {
      return Effect.fail(new Error(`No model configured for provider ${providerId}`));
    }

    const mergedOptions = {
      ...definition.config.modelDefaults,
      ...overrides,
    };

    return definition.getModel(selectedModel, mergedOptions);
  };

  return { layer, getModel, listProviders };
}

export function resolveProviderAliases(customAliases?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_ALIASES, ...(customAliases ?? {}) };
}
