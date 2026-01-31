import { Data } from 'effect';

/**
 * Error thrown when a pipeline is not found by ID.
 */
export class PipelineNotFoundError extends Data.TaggedError("PipelineNotFoundError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when attempting to create a pipeline with an ID that already exists.
 */
export class PipelineAlreadyExistsError extends Data.TaggedError("PipelineAlreadyExistsError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when pipeline execution fails.
 */
export class PipelineExecutionError extends Data.TaggedError("PipelineExecutionError")<{
  readonly pipelineId: string;
  readonly step: number;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when a specific pipeline step fails.
 */
export class PipelineStepError extends Data.TaggedError("PipelineStepError")<{
  readonly pipelineId: string;
  readonly stepName: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when a checkpoint is not found.
 */
export class CheckpointNotFoundError extends Data.TaggedError("CheckpointNotFoundError")<{
  readonly runId: string;
  readonly step?: number;
}> {}

/**
 * Error thrown when a checkpoint has expired.
 */
export class CheckpointExpiredError extends Data.TaggedError("CheckpointExpiredError")<{
  readonly runId: string;
}> {}

/**
 * Error thrown when a pause state is not found.
 */
export class PauseNotFoundError extends Data.TaggedError("PauseNotFoundError")<{
  readonly runId: string;
}> {}

/**
 * Error thrown when a pause state has expired.
 */
export class PauseExpiredError extends Data.TaggedError("PauseExpiredError")<{
  readonly runId: string;
  readonly expiresAt: Date;
}> {}

/**
 * Error thrown when a concurrency issue occurs.
 */
export class ConcurrencyError extends Data.TaggedError("ConcurrencyError")<{
  readonly runId: string;
  readonly operation: string;
}> {}

/**
 * Error thrown when graph workflow validation fails.
 */
export class GraphValidationError extends Data.TaggedError("GraphValidationError")<{
  readonly workflowId: string;
  readonly message: string;
}> {}

/**
 * Union type for all pipeline errors, enabling exhaustive catchTag handling.
 */
export type PipelineError =
  | PipelineNotFoundError
  | PipelineAlreadyExistsError
  | PipelineExecutionError
  | PipelineStepError
  | CheckpointNotFoundError
  | CheckpointExpiredError
  | PauseNotFoundError
  | PauseExpiredError
  | ConcurrencyError
  | GraphValidationError;
