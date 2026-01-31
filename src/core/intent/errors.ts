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
 * Error thrown when no handler is registered for an action type.
 */
export class ActionHandlerNotFoundError extends Data.TaggedError("ActionHandlerNotFoundError")<{
  readonly actionType: string;
}> {}

/**
 * Error thrown when routing to default agent but none is configured.
 */
export class DefaultAgentNotConfiguredError extends Data.TaggedError("DefaultAgentNotConfiguredError")<{
  readonly message?: string;
}> {}

/**
 * Error thrown when routing to an intent action fails.
 */
export class IntentRouteError extends Data.TaggedError("IntentRouteError")<{
  readonly intentId: string;
  readonly cause: Error;
}> {}

/**
 * Union type for all intent errors, enabling exhaustive catchTag handling.
 */
export type IntentError =
  | IntentMatchError
  | IntentNotFoundError
  | ActionHandlerNotFoundError
  | DefaultAgentNotConfiguredError
  | IntentRouteError;
