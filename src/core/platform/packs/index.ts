import type { EffectProviderFactory } from '../base';
import { OpenAiProviderFactory } from './openai';
import { AnthropicProviderFactory } from './anthropic';
import { GoogleProviderFactory } from './google';
import { GroqProviderFactory } from './groq';
import { OpenRouterProviderFactory } from './openrouter';

/**
 * Registry of built-in provider packs.
 *
 * Maps provider ID to its factory implementation.
 * Built-in packs use the same EffectProviderFactory interface
 * as external packs, making them interchangeable.
 */
export const BUILTIN_PACKS: Record<string, EffectProviderFactory> = {
  anthropic: AnthropicProviderFactory,
  google: GoogleProviderFactory,
  groq: GroqProviderFactory,
  openai: OpenAiProviderFactory,
  openrouter: OpenRouterProviderFactory,
};

/**
 * Load a built-in pack by ID.
 *
 * @param id - Provider ID (case-insensitive)
 * @returns The provider factory or null if not a built-in
 */
export function loadBuiltinPack(id: string): EffectProviderFactory | null {
  return BUILTIN_PACKS[id.toLowerCase()] ?? null;
}

/**
 * Check if a provider ID corresponds to a built-in pack.
 *
 * @param id - Provider ID (case-insensitive)
 * @returns True if the ID matches a built-in pack
 */
export function isBuiltinPack(id: string): boolean {
  return id.toLowerCase() in BUILTIN_PACKS;
}

/**
 * Get all built-in pack IDs.
 *
 * @returns Array of built-in provider IDs
 */
export function getBuiltinPackIds(): string[] {
  return Object.keys(BUILTIN_PACKS);
}

// Re-export individual factories for direct access
export { OpenAiProviderFactory } from './openai';
export { AnthropicProviderFactory } from './anthropic';
export { GoogleProviderFactory } from './google';
export { GroqProviderFactory } from './groq';
export { OpenRouterProviderFactory } from './openrouter';
