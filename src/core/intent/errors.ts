import { Data } from 'effect';

/**
 * Error thrown when regex pattern is invalid or semantic matching fails.
 */
export class IntentMatchError extends Data.TaggedError("IntentMatchError")<{
  readonly message: string;
  readonly cause?: Error;
}> {}

/**
 * Error thrown when no intents match the user message.
 */
export class IntentNotFoundError extends Data.TaggedError("IntentNotFoundError")<{
  readonly message: string;
}> {}

/**
 * Union type for all intent errors, enabling exhaustive catchTag handling.
 */
export type IntentError = IntentMatchError | IntentNotFoundError;
