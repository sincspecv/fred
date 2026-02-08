/**
 * Config validation diagnostics formatter
 *
 * Provides structured, actionable diagnostic messages for config validation errors.
 */

import type { ConfigDiagnostic, DiagnosticSeverity } from './types';

/**
 * Format a single config diagnostic into a structured object
 *
 * @param error - Error object or message
 * @param configPath - Path to config file
 * @returns Structured diagnostic
 */
export function formatConfigDiagnostic(
  error: Error | string,
  configPath?: string
): ConfigDiagnostic {
  const message = typeof error === 'string' ? error : error.message;

  // Attempt to extract location information from error message
  const locationMatch = message.match(/at line (\d+), column (\d+)/i);
  const line = locationMatch ? parseInt(locationMatch[1], 10) : undefined;
  const column = locationMatch ? parseInt(locationMatch[2], 10) : undefined;

  // Determine diagnostic code based on error message patterns
  const code = inferDiagnosticCode(message);

  // Generate actionable fix hint
  const fix = generateFixHint(code, message, configPath);

  return {
    code,
    severity: 'error',
    message: cleanMessage(message),
    path: configPath,
    line,
    column,
    fix,
  };
}

/**
 * Format multiple diagnostics
 *
 * @param errors - Array of errors
 * @param configPath - Path to config file
 * @returns Array of structured diagnostics
 */
export function formatDiagnostics(
  errors: Array<Error | string>,
  configPath?: string
): ConfigDiagnostic[] {
  return errors.map(error => formatConfigDiagnostic(error, configPath));
}

/**
 * Infer diagnostic code from error message
 */
function inferDiagnosticCode(message: string): string {
  const lowerMessage = message.toLowerCase();

  // Parsing errors
  if (lowerMessage.includes('unexpected token') || lowerMessage.includes('json')) {
    return 'config-parse-error';
  }

  // Missing required fields
  if (lowerMessage.includes('must have') || lowerMessage.includes('required')) {
    return 'config-missing-field';
  }

  // Type errors
  if (lowerMessage.includes('must be') && lowerMessage.includes('type')) {
    return 'config-type-error';
  }

  // Duplicate IDs
  if (lowerMessage.includes('duplicate')) {
    return 'config-duplicate-id';
  }

  // Reference errors (unknown agent/tool/intent) - check before general "unknown"
  if (lowerMessage.includes('unknown') && (lowerMessage.includes('agent') || lowerMessage.includes('tool') || lowerMessage.includes('intent') || lowerMessage.includes('pipeline'))) {
    return 'config-unknown-reference';
  }

  // Validation errors (after more specific checks)
  if (lowerMessage.includes('invalid') || lowerMessage.includes('unknown')) {
    return 'config-validation-error';
  }

  // File not found
  if (lowerMessage.includes('no such file') || lowerMessage.includes('cannot find') || lowerMessage.includes('not found')) {
    return 'config-file-not-found';
  }

  // Permission errors
  if (lowerMessage.includes('permission') || lowerMessage.includes('eacces')) {
    return 'config-permission-error';
  }

  // Import/module errors
  if (lowerMessage.includes('import') || lowerMessage.includes('module')) {
    return 'config-import-error';
  }

  // Default
  return 'config-error';
}

/**
 * Generate actionable fix hint based on diagnostic code
 */
function generateFixHint(code: string, message: string, configPath?: string): string | undefined {
  switch (code) {
    case 'config-parse-error':
      return 'Check JSON syntax or TypeScript export format. Ensure valid JSON or valid TypeScript module export.';

    case 'config-missing-field': {
      // Try to extract field name from message
      const fieldMatch = message.match(/["']([^"']+)["']\s+must have/i) ||
                         message.match(/must have\s+(?:an?\s+)?["']?([^"'\s]+)["']?/i);
      if (fieldMatch) {
        return `Add required field "${fieldMatch[1]}" to your config.`;
      }
      return 'Add the required field mentioned in the error message.';
    }

    case 'config-type-error': {
      const typeMatch = message.match(/must be (?:a |an )?["']?([^"'\s]+)["']?/i);
      if (typeMatch) {
        return `Change field type to ${typeMatch[1]}.`;
      }
      return 'Fix the field type to match the expected type.';
    }

    case 'config-validation-error': {
      // Extract entity type (agent, tool, intent, etc.)
      const entityMatch = message.match(/(agent|tool|intent|pipeline|workflow)(?:\s+["']([^"']+)["'])?/i);
      if (entityMatch) {
        const entity = entityMatch[1];
        const id = entityMatch[2];
        if (id) {
          return `Review ${entity} "${id}" configuration and fix validation errors.`;
        }
        return `Review ${entity} configuration and fix validation errors.`;
      }
      return 'Review config and fix validation errors mentioned above.';
    }

    case 'config-duplicate-id': {
      const idMatch = message.match(/["']([^"']+)["']/);
      if (idMatch) {
        return `Rename duplicate ID "${idMatch[1]}" to be unique.`;
      }
      return 'Ensure all IDs are unique across the config.';
    }

    case 'config-unknown-reference': {
      const refMatch = message.match(/unknown\s+(?:agent|tool|intent|pipeline)\s+["']([^"']+)["']/i);
      if (refMatch) {
        return `Define "${refMatch[1]}" in your config or fix the reference.`;
      }
      return 'Define the referenced entity or fix the reference.';
    }

    case 'config-file-not-found':
      return configPath
        ? `Ensure ${configPath} exists and is readable.`
        : 'Ensure the config file exists and is readable.';

    case 'config-permission-error':
      return configPath
        ? `Check file permissions for ${configPath}.`
        : 'Check file permissions for the config file.';

    case 'config-import-error':
      return 'Ensure all imported modules are installed and accessible.';

    default:
      return undefined;
  }
}

/**
 * Clean up error message for display
 * Removes stack traces and technical noise
 */
function cleanMessage(message: string): string {
  // Remove stack trace if present
  const lines = message.split('\n');
  const firstLine = lines[0].trim();

  // Remove "Error: " prefix if present
  return firstLine.replace(/^Error:\s*/i, '');
}

/**
 * Aggregate multiple errors into a single diagnostic summary
 * Useful for showing "N errors found" messages
 */
export function aggregateDiagnostics(diagnostics: ConfigDiagnostic[]): {
  errors: number;
  warnings: number;
  summary: string;
} {
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  const warnings = diagnostics.filter(d => d.severity === 'warning').length;

  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
  }
  if (warnings > 0) {
    parts.push(`${warnings} warning${warnings !== 1 ? 's' : ''}`);
  }

  const summary = parts.length > 0
    ? `Found ${parts.join(' and ')}`
    : 'No issues found';

  return { errors, warnings, summary };
}
