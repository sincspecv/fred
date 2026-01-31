/**
 * CheckpointService - Effect-based checkpoint operations.
 *
 * Provides Effect-based API for checkpoint management with proper error typing
 * and dependency injection. Wraps CheckpointStorage with TTL handling.
 */

import { Context, Effect, Layer, Ref } from 'effect';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './types';
import type { PipelineContext } from '../context';
import type { PauseMetadata } from '../pause/types';
import {
  CheckpointNotFoundError,
  CheckpointExpiredError,
} from '../errors';

/**
 * Options for saving a checkpoint.
 */
export interface SaveCheckpointOptions {
  /** Unique run identifier */
  runId: string;

  /** Pipeline identifier */
  pipelineId: string;

  /** Step number (0-indexed) */
  step: number;

  /** Checkpoint status */
  status: CheckpointStatus;

  /** Full pipeline context at this step */
  context: PipelineContext;

  /** Optional custom expiration time (overrides default TTL) */
  expiresAt?: Date;

  /** Step name for resilient resume (optional) */
  stepName?: string;

  /** Pause metadata (only set when status is 'paused') */
  pauseMetadata?: PauseMetadata;
}

/**
 * CheckpointService interface.
 *
 * Provides Effect-based checkpoint operations with typed errors.
 */
export interface CheckpointService {
  /**
   * Generate a unique run ID using crypto.randomUUID().
   * @returns A UUID string suitable for run identification
   */
  generateRunId(): Effect.Effect<string>;

  /**
   * Save a checkpoint with automatic TTL handling.
   *
   * @param options - Checkpoint data including runId, pipelineId, step, status, context
   */
  saveCheckpoint(options: SaveCheckpointOptions): Effect.Effect<void>;

  /**
   * Get the latest checkpoint for a run (highest step number).
   *
   * @param runId - The run identifier
   * @returns The latest checkpoint or fails with CheckpointNotFoundError
   */
  getLatestCheckpoint(runId: string): Effect.Effect<Checkpoint, CheckpointNotFoundError>;

  /**
   * Get a specific checkpoint by run ID and step.
   *
   * @param runId - The run identifier
   * @param step - The step number
   * @returns The checkpoint or fails with CheckpointNotFoundError
   */
  getCheckpoint(runId: string, step: number): Effect.Effect<Checkpoint, CheckpointNotFoundError>;

  /**
   * Update the status of a checkpoint.
   *
   * @param runId - The run identifier
   * @param step - The step number
   * @param status - The new status
   */
  updateStatus(runId: string, step: number, status: CheckpointStatus): Effect.Effect<void>;

  /**
   * Mark a run as completed.
   * Convenience method for updateStatus with 'completed' status.
   *
   * @param runId - The run identifier
   * @param step - The step number
   */
  markCompleted(runId: string, step: number): Effect.Effect<void>;

  /**
   * Mark a run as failed.
   * Convenience method for updateStatus with 'failed' status.
   *
   * @param runId - The run identifier
   * @param step - The step number
   */
  markFailed(runId: string, step: number): Effect.Effect<void>;

  /**
   * Delete all checkpoints for a run.
   * Useful for cleanup after successful completion.
   *
   * @param runId - The run identifier
   */
  deleteRun(runId: string): Effect.Effect<void>;

  /**
   * Delete expired checkpoints.
   * Call this periodically for automatic cleanup.
   *
   * @returns The number of deleted checkpoints
   */
  deleteExpired(): Effect.Effect<number>;

  /**
   * Get the underlying storage (for PauseManager access).
   * @internal
   */
  getStorage(): Effect.Effect<CheckpointStorage>;
}

export const CheckpointService = Context.GenericTag<CheckpointService>(
  'CheckpointService'
);

/**
 * Implementation of CheckpointService.
 */
class CheckpointServiceImpl implements CheckpointService {
  /** Default TTL: 7 days in milliseconds */
  static readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private storage: CheckpointStorage,
    private defaultTtlMs: Ref.Ref<number>
  ) {}

  generateRunId(): Effect.Effect<string> {
    return Effect.sync(() => crypto.randomUUID());
  }

  saveCheckpoint(options: SaveCheckpointOptions): Effect.Effect<void> {
    return Effect.gen(function* () {
      const now = new Date();
      const ttl = yield* Ref.get(this.defaultTtlMs);
      const expiresAt = options.expiresAt ?? new Date(now.getTime() + ttl);

      yield* Effect.tryPromise({
        try: () =>
          this.storage.save({
            runId: options.runId,
            pipelineId: options.pipelineId,
            step: options.step,
            status: options.status,
            context: options.context,
            createdAt: now,
            updatedAt: now,
            expiresAt,
            stepName: options.stepName,
            pauseMetadata: options.pauseMetadata,
          }),
        catch: (error) => error,
      });
    }.bind(this));
  }

  getLatestCheckpoint(runId: string): Effect.Effect<Checkpoint, CheckpointNotFoundError> {
    return Effect.gen(function* () {
      const checkpoint = yield* Effect.tryPromise({
        try: () => this.storage.getLatest(runId),
        catch: (error) => error,
      });

      if (!checkpoint) {
        return yield* Effect.fail(new CheckpointNotFoundError({ runId }));
      }

      return checkpoint;
    }.bind(this));
  }

  getCheckpoint(runId: string, step: number): Effect.Effect<Checkpoint, CheckpointNotFoundError> {
    return Effect.gen(function* () {
      const checkpoint = yield* Effect.tryPromise({
        try: () => this.storage.get(runId, step),
        catch: (error) => error,
      });

      if (!checkpoint) {
        return yield* Effect.fail(new CheckpointNotFoundError({ runId, step }));
      }

      return checkpoint;
    }.bind(this));
  }

  updateStatus(runId: string, step: number, status: CheckpointStatus): Effect.Effect<void> {
    return Effect.tryPromise({
      try: () => this.storage.updateStatus(runId, step, status),
      catch: (error) => error,
    });
  }

  markCompleted(runId: string, step: number): Effect.Effect<void> {
    return this.updateStatus(runId, step, 'completed');
  }

  markFailed(runId: string, step: number): Effect.Effect<void> {
    return this.updateStatus(runId, step, 'failed');
  }

  deleteRun(runId: string): Effect.Effect<void> {
    return Effect.tryPromise({
      try: () => this.storage.deleteRun(runId),
      catch: (error) => error,
    });
  }

  deleteExpired(): Effect.Effect<number> {
    return Effect.tryPromise({
      try: () => this.storage.deleteExpired(),
      catch: (error) => error,
    });
  }

  getStorage(): Effect.Effect<CheckpointStorage> {
    return Effect.succeed(this.storage);
  }
}

/**
 * Options for creating CheckpointServiceLive layer.
 */
export interface CheckpointServiceLiveOptions {
  /** Underlying storage adapter (Postgres, SQLite, etc.) */
  storage: CheckpointStorage;

  /** Default TTL in milliseconds. Default: 7 days */
  defaultTtlMs?: number;
}

/**
 * Create a Live layer for CheckpointService with provided storage.
 *
 * @param options - Configuration including storage and optional TTL
 */
export const CheckpointServiceLive = (options: CheckpointServiceLiveOptions) =>
  Layer.effect(
    CheckpointService,
    Effect.gen(function* () {
      const ttl = options.defaultTtlMs ?? CheckpointServiceImpl.DEFAULT_TTL_MS;
      const defaultTtlMs = yield* Ref.make(ttl);
      return new CheckpointServiceImpl(options.storage, defaultTtlMs);
    })
  );
