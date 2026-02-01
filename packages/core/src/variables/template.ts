import { Effect } from 'effect';
import type { VariableValue } from './service.js';

/**
 * Template variable resolver
 * Finds and replaces {{ var_name }} placeholders with actual values
 */

/**
 * Extract all variable names from a template string
 * @param template - String potentially containing {{ var_name }} placeholders
 * @returns Array of variable names found
 */
export function extractVariableNames(template: string): string[] {
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const matches: string[] = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    matches.push(match[1]);
  }

  return Array.from(new Set(matches)); // Remove duplicates
}

/**
 * Resolve a template string by replacing all {{ var_name }} with values
 * @param template - String with {{ var_name }} placeholders
 * @param variables - Map of variable names to values
 * @param options - Resolution options
 * @returns Resolved string with all variables replaced
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, VariableValue>,
  options?: {
    /** If true, throw on missing variables. If false, leave placeholder unchanged */
    strict?: boolean;
    /** If true, remove unresolved placeholders. If false, leave them as-is */
    removeUnresolved?: boolean;
  }
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const strict = options?.strict ?? false;
    const removeUnresolved = options?.removeUnresolved ?? false;

    let resolved = template;
    const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

    resolved = resolved.replace(regex, (match, varName) => {
      const value = variables[varName];

      if (value !== undefined) {
        return String(value);
      }

      if (strict) {
        throw new Error(`Variable "${varName}" not found in template`);
      }

      if (removeUnresolved) {
        return '';
      }

      // Leave placeholder unchanged
      return match;
    });

    return resolved;
  });
}

/**
 * Resolve template with async variable fetching
 * @param template - String with {{ var_name }} placeholders
 * @param variableResolver - Function that resolves a variable name to a value
 * @param options - Resolution options
 * @returns Effect that resolves to the interpolated string
 */
export function resolveTemplateAsync(
  template: string,
  variableResolver: (name: string) => Effect.Effect<VariableValue>,
  options?: {
    strict?: boolean;
    removeUnresolved?: boolean;
  }
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const strict = options?.strict ?? false;
    const removeUnresolved = options?.removeUnresolved ?? false;

    // Extract all variable names
    const varNames = extractVariableNames(template);

    // Resolve all variables in parallel
    const variableEffects = varNames.map(name =>
      Effect.gen(function* () {
        try {
          const value = yield* variableResolver(name);
          return { name, value, found: true };
        } catch {
          if (strict) {
            return yield* Effect.fail(new Error(`Variable "${name}" not found`));
          }
          return { name, value: undefined, found: false };
        }
      }).pipe(Effect.orDie)
    );

    const results = yield* Effect.all(variableEffects, { concurrency: 'unbounded' });

    // Build variables map
    const variables: Record<string, VariableValue> = {};
    for (const result of results) {
      if (result.found && result.value !== undefined) {
        variables[result.name] = result.value;
      }
    }

    // Resolve template
    return yield* resolveTemplate(template, variables, {
      strict: false, // We already handled strict mode above
      removeUnresolved,
    });
  });
}

/**
 * Check if a template string contains any variable placeholders
 */
export function hasVariables(template: string): boolean {
  return /\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/.test(template);
}

/**
 * Validate variable names in a template
 * Returns array of invalid variable names (names that don't match allowed pattern)
 */
export function validateTemplate(template: string): string[] {
  const regex = /\{\{\s*([^\}]+)\s*\}\}/g;
  const invalid: string[] = [];
  let match;

  while ((match = regex.exec(template)) !== null) {
    const varName = match[1].trim();
    // Valid variable names: start with letter or underscore, followed by letters, numbers, or underscores
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      invalid.push(varName);
    }
  }

  return invalid;
}
