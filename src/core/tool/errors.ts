import { Data } from 'effect';

/**
 * Error thrown when a tool is not found by ID.
 */
export class ToolNotFoundError extends Data.TaggedError("ToolNotFoundError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when attempting to register a tool with an ID that already exists.
 */
export class ToolAlreadyExistsError extends Data.TaggedError("ToolAlreadyExistsError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when tool validation fails.
 */
export class ToolValidationError extends Data.TaggedError("ToolValidationError")<{
  readonly id: string;
  readonly message: string;
}> {}

/**
 * Error thrown when tool execution fails.
 */
export class ToolExecutionError extends Data.TaggedError("ToolExecutionError")<{
  readonly id: string;
  readonly cause: unknown;
}> {}

/**
 * Union type for all tool errors, enabling exhaustive catchTag handling.
 */
export type ToolError =
  | ToolNotFoundError
  | ToolAlreadyExistsError
  | ToolValidationError
  | ToolExecutionError;
