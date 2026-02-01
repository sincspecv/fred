import type { EffectProviderFactory } from '../base';

/**
 * Dynamic registry for provider packs.
 *
 * Supports both built-in providers (from @fred/provider-* packages) and
 * external providers (registered at runtime by custom packages).
 *
 * Provider packages auto-register themselves when imported:
 *
 * @example
 * ```typescript
 * // In your application:
 * import '@fred/provider-openai';  // Auto-registers OpenAI provider
 * import '@fred/provider-anthropic';  // Auto-registers Anthropic provider
 *
 * // Now these providers are available via Fred's provider system
 * await fred.useProvider('openai');
 * await fred.useProvider('anthropic');
 * ```
 */
const packRegistry = new Map<string, EffectProviderFactory>();

/**
 * Register a provider pack in the registry.
 *
 * This function is used by provider packages to register themselves:
 * - Built-in providers from @fred/provider-* packages call this on import
 * - External providers can also call this during their initialization
 *
 * @param pack - The provider factory to register
 */
export function registerBuiltinPack(pack: EffectProviderFactory): void {
  packRegistry.set(pack.id.toLowerCase(), pack);
  // Also register aliases
  pack.aliases?.forEach(alias => packRegistry.set(alias.toLowerCase(), pack));
}

/**
 * Get a registered provider pack by ID.
 *
 * @param id - Provider ID (case-insensitive)
 * @returns The provider factory or undefined if not found
 */
export function getBuiltinPack(id: string): EffectProviderFactory | undefined {
  return packRegistry.get(id.toLowerCase());
}

/**
 * Get all registered provider pack IDs.
 *
 * @returns Array of unique provider IDs (excludes aliases)
 */
export function getBuiltinPackIds(): string[] {
  return [...new Set([...packRegistry.values()].map(p => p.id))];
}

/**
 * Load a built-in pack by ID.
 *
 * @param id - Provider ID (case-insensitive)
 * @returns The provider factory or null if not found
 * @deprecated Use getBuiltinPack instead for consistent naming
 */
export function loadBuiltinPack(id: string): EffectProviderFactory | null {
  return getBuiltinPack(id) ?? null;
}

/**
 * Check if a provider ID corresponds to a registered pack.
 *
 * @param id - Provider ID (case-insensitive)
 * @returns True if the ID matches a registered pack
 */
export function isBuiltinPack(id: string): boolean {
  return packRegistry.has(id.toLowerCase());
}

/**
 * Legacy BUILTIN_PACKS export for backward compatibility.
 *
 * This object is dynamically populated from the registry.
 * Prefer using getBuiltinPack() or getBuiltinPackIds() instead.
 *
 * @deprecated Access registry via getBuiltinPack/getBuiltinPackIds functions
 */
export const BUILTIN_PACKS: Record<string, EffectProviderFactory> = new Proxy(
  {} as Record<string, EffectProviderFactory>,
  {
    get: (_target, prop: string) => packRegistry.get(prop.toLowerCase()),
    has: (_target, prop: string) => packRegistry.has((prop as string).toLowerCase()),
    ownKeys: () => [...packRegistry.keys()],
    getOwnPropertyDescriptor: (_target, prop: string) => {
      if (packRegistry.has((prop as string).toLowerCase())) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    },
  }
);

// =============================================================================
// Provider implementations moved to @fred/provider-* packages
// =============================================================================
//
// To use providers, install the corresponding package and import it:
//
//   import '@fred/provider-openai';     // OpenAI via @effect/ai-openai
//   import '@fred/provider-anthropic';  // Anthropic via @effect/ai-anthropic
//   import '@fred/provider-google';     // Google/Gemini via @effect/ai-google
//   import '@fred/provider-groq';       // Groq (Chat Completions API)
//   import '@fred/provider-openrouter'; // OpenRouter via @effect/ai-openai
//
// Each provider auto-registers itself when imported.
// =============================================================================
