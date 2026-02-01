/**
 * Effect Schema for validating provider pack exports at load time.
 *
 * Ensures that npm packages exported as provider packs have the correct
 * structure before attempting to use them.
 */

import { Schema, ParseResult } from 'effect';
import type { EffectProviderFactory } from './base';
import { ProviderPackLoadError } from './errors';

/**
 * Custom schema for validating that a value is a function.
 */
const FunctionSchema = Schema.declare(
  (input: unknown): input is (...args: unknown[]) => unknown => typeof input === 'function',
  {
    identifier: 'Function',
    description: 'A function',
  }
);

/**
 * Effect Schema for validating EffectProviderFactory structure.
 *
 * Note: We can't fully validate function return types at runtime,
 * but we can ensure the basic shape is correct.
 */
export const ProviderFactorySchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1, { message: () => 'Provider id is required' })),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  load: FunctionSchema,
});

/**
 * Type inferred from the schema (subset of EffectProviderFactory).
 */
export type ValidatedProviderFactory = Schema.Schema.Type<typeof ProviderFactorySchema>;

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
 * Format Effect Schema parse error into human-readable string.
 */
function formatParseError(error: ParseResult.ParseError): string {
  // Use Effect Schema's built-in error formatting via TreeFormatter
  const message = String(error);
  // Indent each line for consistent formatting
  return message
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
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

  try {
    const decoded = Schema.decodeUnknownSync(ProviderFactorySchema)(factory);
    // Cast is safe because we validated the structure.
    // Runtime behavior of load() is validated separately when called.
    return decoded as unknown as EffectProviderFactory;
  } catch (error) {
    const issues = ParseResult.isParseError(error)
      ? formatParseError(error)
      : String(error);

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
  try {
    Schema.decodeUnknownSync(ProviderFactorySchema)(obj);
    return true;
  } catch {
    return false;
  }
}
