import { Schema } from 'effect';
import { Tool } from './tool';

export interface ToolCoercion {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ToolValidationMetadata {
  coerced: boolean;
  coercions: ToolCoercion[];
}

export interface ToolValidationSuccess<Input> {
  ok: true;
  value: Input;
  metadata: ToolValidationMetadata;
}

export interface ToolValidationFailure {
  ok: false;
  error: ToolValidationError;
}

/**
 * Field-level validation error kinds
 */
export type FieldErrorKind = 'missing' | 'invalid' | 'wrong_type';

/**
 * Structured field-level validation error
 * Format: field name + error type (e.g., "email: invalid")
 */
export interface FieldValidationError {
  /** Field path (e.g., "email" or "address.city") */
  field: string;
  /** Error kind: missing, invalid, or wrong_type */
  kind: FieldErrorKind;
  /** Human-readable error message */
  message: string;
  /** Expected type or format (for wrong_type/invalid) */
  expected?: string;
  /** Actual value or type received (for wrong_type) */
  actual?: string;
}

export interface ToolValidationError {
  message: string;
  /** Legacy string-based issues for backward compatibility */
  issues: string[];
  /** Structured field-level errors for model self-correction */
  fieldErrors?: FieldValidationError[];
  stack?: string;
  coercions?: ToolCoercion[];
}

export interface ToolValidationResult<Input> {
  result: ToolValidationSuccess<Input> | ToolValidationFailure;
}

export interface ToolValidationOutcome<Input> {
  output: Input;
  metadata: ToolValidationMetadata;
}

const defaultMetadata: ToolValidationMetadata = {
  coerced: false,
  coercions: [],
};

function stripUnknownFields<Input>(input: Input, schema: Schema.Schema<Input>): Input {
  const decoded = Schema.decodeUnknownSync(schema, { errors: 'all' })(input);
  const encoded = Schema.encodeSync(schema)(decoded);
  return Schema.decodeUnknownSync(schema, { errors: 'all', onExcessProperty: 'ignore' })(encoded);
}

function detectCoercions<Input>(input: Input, decoded: Input): ToolValidationMetadata {
  const coercions: ToolCoercion[] = [];

  const inspect = (before: unknown, after: unknown, path: string): void => {
    if (before === after) {
      return;
    }
    if (typeof before !== typeof after) {
      coercions.push({ path, before, after });
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const length = Math.max(before.length, after.length);
      for (let i = 0; i < length; i += 1) {
        inspect(before[i], after[i], `${path}[${i}]`);
      }
      return;
    }
    if (before && after && typeof before === 'object' && typeof after === 'object') {
      const beforeRecord = before as Record<string, unknown>;
      const afterRecord = after as Record<string, unknown>;
      const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
      for (const key of keys) {
        inspect(beforeRecord[key], afterRecord[key], path ? `${path}.${key}` : key);
      }
    }
  };

  inspect(input, decoded, '');

  return {
    coerced: coercions.length > 0,
    coercions,
  };
}

/**
 * Parse Effect Schema error message to extract field errors
 * Effect Schema formats errors like:
 *   { readonly name: string; readonly email: string }
 *   └─ ["email"]
 *      └─ is missing
 *
 * Or for type errors:
 *   { readonly age: number }
 *   └─ ["age"]
 *      └─ Expected number, actual "twenty"
 */
function parseEffectSchemaMessage(message: string): FieldValidationError[] {
  const fieldErrors: FieldValidationError[] = [];
  const lines = message.split('\n');

  let currentField = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match field path: ["fieldName"] or [0]
    const fieldMatch = line.match(/\["?([^"\]]+)"?\]/);
    if (fieldMatch) {
      currentField = fieldMatch[1];
      continue;
    }

    // Match error description
    if (line.startsWith('└─')) {
      const errorText = line.replace(/^└─\s*/, '').trim();

      // Determine error kind
      let kind: FieldErrorKind = 'invalid';
      let expected: string | undefined;
      let actual: string | undefined;

      if (errorText.toLowerCase().includes('is missing')) {
        kind = 'missing';
      } else if (errorText.toLowerCase().includes('expected')) {
        kind = 'wrong_type';
        // Parse "Expected X, actual Y"
        const expectedMatch = errorText.match(/Expected\s+(\S+)/i);
        const actualMatch = errorText.match(/actual\s+"?([^"]+)"?$/i);
        if (expectedMatch) expected = expectedMatch[1].replace(/,\s*$/, '');
        if (actualMatch) actual = actualMatch[1];
      }

      if (currentField) {
        fieldErrors.push({
          field: currentField,
          kind,
          message: `${currentField}: ${kind}`,
          expected,
          actual,
        });
      }
    }
  }

  return fieldErrors;
}

/**
 * Recursively collect field errors from Effect Schema ParseError
 */
function collectFieldErrors(error: unknown): FieldValidationError[] {
  const fieldErrors: FieldValidationError[] = [];

  // Handle Effect Schema ParseError structure
  if (error && typeof error === 'object') {
    const err = error as any;

    // Effect Schema ParseError has a formatted message property
    if (err._tag === 'ParseError' && typeof err.message === 'string') {
      return parseEffectSchemaMessage(err.message);
    }

    // Handle nested error structures
    if (Array.isArray(err.errors)) {
      for (const nestedError of err.errors) {
        fieldErrors.push(...collectFieldErrors(nestedError));
      }
    }

    if (Array.isArray(err.issues)) {
      for (const issue of err.issues) {
        fieldErrors.push(...collectFieldErrors(issue));
      }
    }
  }

  return fieldErrors;
}

/**
 * Collect legacy string-based issues for backward compatibility
 */
function collectIssues(error: unknown): string[] {
  if (error && typeof error === 'object' && '_tag' in error) {
    return [String((error as { _tag: string })._tag)];
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return ['Unknown validation error'];
}

/**
 * Build structured validation error from Effect Schema ParseError
 */
function buildValidationError(toolId: string, error: unknown): ToolValidationError {
  const issues = collectIssues(error);
  const fieldErrors = collectFieldErrors(error);

  // Build field-level formatted issues: "field: kind"
  const formattedIssues = fieldErrors.length > 0
    ? fieldErrors.map(fe => `${fe.field}: ${fe.kind}${fe.expected ? ` (expected ${fe.expected})` : ''}`)
    : issues;

  return {
    message: `Tool "${toolId}" input validation failed`,
    issues: formattedIssues,
    fieldErrors: fieldErrors.length > 0 ? fieldErrors : undefined,
    stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
  };
}

export function decodeToolInputs<Input>(tool: Tool<Input>, input: unknown): ToolValidationResult<Input> {
  const schema = tool.schema?.input;

  if (!schema) {
    if (tool.strict) {
      return {
        result: {
          ok: false,
          error: {
            message: `Tool "${tool.id}" is missing an input schema`,
            issues: ['schema_missing'],
          },
        },
      };
    }

    return {
      result: {
        ok: true,
        value: input as Input,
        metadata: defaultMetadata,
      },
    };
  }

  try {
    const decoded = stripUnknownFields(input as Input, schema);
    const metadata = detectCoercions(input as Input, decoded);
    return {
      result: {
        ok: true,
        value: decoded,
        metadata,
      },
    };
  } catch (error) {
    return {
      result: {
        ok: false,
        error: buildValidationError(tool.id, error),
      },
    };
  }
}

export function getDecodedToolInputs<Input>(tool: Tool<Input>, input: unknown): ToolValidationOutcome<Input> {
  const { result } = decodeToolInputs(tool, input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }

  return {
    output: result.value,
    metadata: result.metadata,
  };
}

export function validateToolSchema(tool: Tool): void {
  if (tool.strict && !tool.schema?.input) {
    throw new Error(`Tool "${tool.id}" requires an input schema when strict mode is enabled`);
  }
}

export function wrapToolExecution<Input, Output>(
  tool: Tool<Input, Output, unknown>,
  execute: (args: Input) => Promise<Output> | Output
): (args: unknown) => Promise<Output> {
  return async (args: unknown) => {
    const decoded = getDecodedToolInputs(tool as Tool<Input, unknown, unknown>, args);
    const result = await execute(decoded.output as Input);
    // Return just the result - @effect/ai expects the raw output matching the tool's success schema
    return result;
  };
}
