/**
 * Zod schema for validating provider pack exports at load time.
 *
 * Ensures that npm packages exported as provider packs have the correct
 * structure before attempting to use them.
 */

import { z } from 'zod';
import type { EffectProviderFactory } from './base';
import { ProviderPackLoadError } from './errors';

/**
 * Zod schema for validating EffectProviderFactory structure.
 *
 * Note: We can't fully validate function return types at runtime,
 * but we can ensure the basic shape is correct.
 */
export const ProviderFactorySchema = z.object({
  id: z.string().min(1, 'Provider id is required'),
  aliases: z.array(z.string()).optional(),
  load: z.function(),
});

/**
 * Type inferred from the schema (subset of EffectProviderFactory).
 */
export type ValidatedProviderFactory = z.infer<typeof ProviderFactorySchema>;

/**
 * Extract the factory object from a dynamically imported module.
 *
 * Handles both default exports and direct module exports:
 * - `export default factory` -> module.default
 * - `export const factory = ...` -> module.factory
 * - Module is the factory itself -> module
 *
 * @param module - The raw imported module
 * @returns The factory object (module.default ?? module)
 */
export function extractFactory(module: unknown): unknown {
  if (module === null || module === undefined) {
    return module;
  }

  // Handle ES module default export
  if (typeof module === 'object' && 'default' in module) {
    return (module as { default: unknown }).default;
  }

  // Module itself is the factory
  return module;
}

/**
 * Validate that an object conforms to the EffectProviderFactory interface.
 *
 * @param exports - The exports from a provider pack module
 * @param packageName - Package name for error messages
 * @returns The validated factory cast to EffectProviderFactory
 * @throws ProviderPackLoadError if validation fails
 */
export function validatePackExports(
  exports: unknown,
  packageName: string
): EffectProviderFactory {
  const factory = extractFactory(exports);

  const result = ProviderFactorySchema.safeParse(factory);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('\n');

    throw new ProviderPackLoadError({
      packageName,
      reason: 'Invalid package exports',
      remediation: [
        'Provider pack must export an object with:',
        '  - id: string (required, non-empty)',
        '  - aliases: string[] (optional)',
        '  - load: (config) => Promise<{ layer, getModel }> (required)',
        '',
        'Validation errors:',
        issues,
      ].join('\n'),
    });
  }

  // Cast is safe because we validated the structure.
  // Runtime behavior of load() is validated separately when called.
  return result.data as unknown as EffectProviderFactory;
}

/**
 * Check if an object looks like an EffectProviderFactory.
 *
 * Use this for quick checks without throwing errors.
 *
 * @param obj - Object to check
 * @returns True if the object has the correct structure
 */
export function isProviderFactory(obj: unknown): obj is EffectProviderFactory {
  return ProviderFactorySchema.safeParse(obj).success;
}
