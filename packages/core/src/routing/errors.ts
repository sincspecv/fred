import { Data } from 'effect';

/**
 * Error when custom matcher function throws
 */
export class RoutingMatcherError extends Data.TaggedError("RoutingMatcherError")<{
  readonly ruleId: string;
  readonly cause: Error;
}> {}

/**
 * Error when no agents are available for fallback
 */
export class NoAgentsAvailableError extends Data.TaggedError("NoAgentsAvailableError")<{
  readonly message: string;
}> {}

/**
 * Union type for exhaustive catchTag handling
 */
export type RoutingError = RoutingMatcherError | NoAgentsAvailableError;
