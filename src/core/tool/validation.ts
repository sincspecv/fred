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

export interface ToolValidationError {
  message: string;
  issues: string[];
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
  return Schema.decodeUnknownSync(schema, { errors: 'all', excessProperty: 'ignore' })(encoded);
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

function collectIssues(error: unknown): string[] {
  if (error && typeof error === 'object' && '_tag' in error) {
    return [String((error as { _tag: string })._tag)];
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return ['Unknown validation error'];
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
        error: {
          message: `Tool "${tool.id}" input validation failed`,
          issues: collectIssues(error),
          stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
        },
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
  tool: Tool<Input, Output>,
  execute: (args: Input) => Promise<Output> | Output
): (args: unknown) => Promise<{ result: Output; metadata: ToolValidationMetadata }> {
  return async (args: unknown) => {
    const decoded = getDecodedToolInputs(tool, args);
    const result = await execute(decoded.output);
    return {
      result,
      metadata: decoded.metadata,
    };
  };
}
