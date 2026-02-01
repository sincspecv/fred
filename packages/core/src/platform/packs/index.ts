import type { EffectProviderFactory } from '../base';

// TODO: Move provider implementations to @fred/provider-* packages in Plan 03
import { OpenAiProviderFactory } from './openai';
import { AnthropicProviderFactory } from './anthropic';
import { GoogleProviderFactory } from './google';
import { GroqProviderFactory } from './groq';
import { OpenRouterProviderFactory } from './openrouter';

/**
 * Dynamic registry for provider packs.
 *
 * Supports both built-in providers (shipped with @fred/core) and
 * external providers (registered at runtime by @fred/provider-* packages).
 */
const packRegistry = new Map<string, EffectProviderFactory>();

/**
 * Register a provider pack in the registry.
 *
 * This function is used by provider packages to register themselves:
 * - Built-in providers register on module load (below)
 * - External providers call this during their initialization
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
// Register built-in providers
// TODO: These registrations will move to @fred/provider-* packages in Plan 03
// =============================================================================

registerBuiltinPack(OpenAiProviderFactory);
registerBuiltinPack(AnthropicProviderFactory);
registerBuiltinPack(GoogleProviderFactory);
registerBuiltinPack(GroqProviderFactory);
registerBuiltinPack(OpenRouterProviderFactory);

// Re-export individual factories for direct access
// TODO: Move to @fred/provider-* packages in Plan 03
export { OpenAiProviderFactory } from './openai';
export { AnthropicProviderFactory } from './anthropic';
export { GoogleProviderFactory } from './google';
export { GroqProviderFactory } from './groq';
export { OpenRouterProviderFactory } from './openrouter';
