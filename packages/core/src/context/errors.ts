import { Data } from 'effect';

/**
 * Error thrown when a context/conversation is not found.
 */
export class ContextNotFoundError extends Data.TaggedError("ContextNotFoundError")<{
  readonly conversationId: string;
}> {}

/**
 * Error thrown when a context storage operation fails.
 */
export class ContextStorageError extends Data.TaggedError("ContextStorageError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * Union type for all context errors, enabling exhaustive catchTag handling.
 */
export type ContextError =
  | ContextNotFoundError
  | ContextStorageError;
