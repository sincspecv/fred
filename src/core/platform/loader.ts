/**
 * Unified pack loader for built-in and external provider packs.
 *
 * Handles loading provider packs from:
 * 1. Built-in packs (openai, anthropic, google)
 * 2. External npm packages via dynamic import
 *
 * All packs go through the same validation and error handling path.
 */

import { loadBuiltinPack, isBuiltinPack } from './packs';
import { validatePackExports } from './pack-schema';
import { ProviderPackLoadError } from './errors';
import type { EffectProviderFactory } from './base';

/**
 * Result type for callers who want to handle errors individually.
 */
export type PackLoadResult =
  | { success: true; factory: EffectProviderFactory }
  | { success: false; error: ProviderPackLoadError };

/**
 * Load a provider pack by ID or npm package name.
 *
 * Resolution order:
 * 1. Check if it's a built-in pack (openai, anthropic, google)
 * 2. Try to load as external npm package via dynamic import
 *
 * @param idOrPackage - Provider ID (for built-ins) or npm package name
 * @returns The provider factory
 * @throws ProviderPackLoadError if the pack cannot be loaded
 */
export async function loadProviderPack(
  idOrPackage: string
): Promise<EffectProviderFactory> {
  // 1. Check if it's a built-in first
  if (isBuiltinPack(idOrPackage)) {
    const factory = loadBuiltinPack(idOrPackage);
    if (factory) return factory;
  }

  // 2. Try to load as external npm package
  try {
    const module = await import(idOrPackage);
    const rawFactory = module.default ?? module;

    // 3. Validate exports with Zod schema
    return validatePackExports(rawFactory, idOrPackage);
  } catch (error) {
    // 4. Convert to tagged error with remediation
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      throw new ProviderPackLoadError({
        packageName: idOrPackage,
        reason: 'Package not installed',
        remediation: `Install the provider pack:\n  bun add ${idOrPackage}`,
        cause: error,
      });
    }

    if (error instanceof ProviderPackLoadError) {
      throw error; // Already a tagged error
    }

    throw new ProviderPackLoadError({
      packageName: idOrPackage,
      reason: 'Failed to load package',
      remediation: `Check that ${idOrPackage} exports a valid provider factory`,
      cause: error,
    });
  }
}

/**
 * Load multiple provider packs with fail-fast behavior.
 *
 * Uses Promise.all so the first failure will abort all loading.
 *
 * @param packs - Array of pack specifications with id and optional package name
 * @returns Array of provider factories in the same order as input
 * @throws ProviderPackLoadError on the first pack that fails to load
 */
export async function loadAllPacks(
  packs: Array<{ id: string; package?: string }>
): Promise<EffectProviderFactory[]> {
  // Use Promise.all to fail-fast on any error
  return Promise.all(
    packs.map(async ({ id, package: pkg }) => {
      const packageToLoad = pkg ?? id;
      return loadProviderPack(packageToLoad);
    })
  );
}

/**
 * Try to load a provider pack without throwing.
 *
 * Useful for batch loading where you want to collect errors
 * rather than fail-fast.
 *
 * @param idOrPackage - Provider ID or npm package name
 * @returns PackLoadResult with success/error status
 */
export async function tryLoadProviderPack(
  idOrPackage: string
): Promise<PackLoadResult> {
  try {
    const factory = await loadProviderPack(idOrPackage);
    return { success: true, factory };
  } catch (error) {
    if (error instanceof ProviderPackLoadError) {
      return { success: false, error };
    }
    // Wrap unexpected errors
    return {
      success: false,
      error: new ProviderPackLoadError({
        packageName: idOrPackage,
        reason: 'Unexpected error during pack loading',
        remediation: 'Check the error cause for details',
        cause: error,
      }),
    };
  }
}
