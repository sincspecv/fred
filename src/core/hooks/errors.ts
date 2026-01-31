import { Data } from 'effect';

/**
 * Error thrown when a hook handler execution fails.
 */
export class HookExecutionError extends Data.TaggedError("HookExecutionError")<{
  readonly hookType: string;
  readonly handlerIndex: number;
  readonly cause: unknown;
}> {}

/**
 * Union type for all hook errors, enabling exhaustive catchTag handling.
 */
export type HookError = HookExecutionError;
