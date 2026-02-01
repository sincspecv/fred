import { Data } from 'effect';

/**
 * Error thrown when an agent is not found by ID.
 */
export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when attempting to create an agent with an ID that already exists.
 */
export class AgentAlreadyExistsError extends Data.TaggedError("AgentAlreadyExistsError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when agent creation fails.
 */
export class AgentCreationError extends Data.TaggedError("AgentCreationError")<{
  readonly id: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when agent execution fails.
 */
export class AgentExecutionError extends Data.TaggedError("AgentExecutionError")<{
  readonly agentId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Union type for all agent errors, enabling exhaustive catchTag handling.
 */
export type AgentError =
  | AgentNotFoundError
  | AgentAlreadyExistsError
  | AgentCreationError
  | AgentExecutionError;
