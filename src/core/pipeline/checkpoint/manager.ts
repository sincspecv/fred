/**
 * CheckpointManager - High-level checkpoint operations.
 *
 * Wraps CheckpointStorage with:
 * - Default TTL handling (7 days)
 * - Run ID generation
 * - Convenience methods for status updates
 */

import { Effect } from 'effect';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './types';
import type { PipelineContext } from '../context';
import type { PauseMetadata } from '../pause/types';
import { withFredSpan } from '../../observability/otel';

/**
 * Options for creating a CheckpointManager.
 */
export interface CheckpointManagerOptions {
  /** Underlying storage adapter (Postgres, SQLite, etc.) */
  storage: CheckpointStorage;

  /** Default TTL in milliseconds. Default: 7 days */
  defaultTtlMs?: number;
}

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
 * High-level checkpoint manager.
 *
 * Provides a developer-friendly API for checkpoint operations with
 * sensible defaults for TTL and run ID generation.
 */
export class CheckpointManager {
  private storage: CheckpointStorage;
  private defaultTtlMs: number;

  /** Default TTL: 7 days in milliseconds */
  static readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(options: CheckpointManagerOptions) {
    this.storage = options.storage;
    this.defaultTtlMs = options.defaultTtlMs ?? CheckpointManager.DEFAULT_TTL_MS;
  }

  /**
   * Generate a unique run ID using crypto.randomUUID().
   * @returns A UUID string suitable for run identification
   */
  generateRunId(): string {
    return crypto.randomUUID();
  }

  /**
   * Save a checkpoint with automatic TTL handling.
   *
   * @param options - Checkpoint data including runId, pipelineId, step, status, context
   */
  async saveCheckpoint(options: SaveCheckpointOptions): Promise<void> {
    const now = new Date();
    const expiresAt = options.expiresAt ?? new Date(now.getTime() + this.defaultTtlMs);

    // Fire-and-forget span annotation to avoid blocking
    Effect.runPromise(
      withFredSpan('checkpoint.save', {
        runId: options.runId,
        workflowId: options.pipelineId,
        stepName: options.stepName,
        'checkpoint.step': options.step,
        'checkpoint.status': options.status,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      await this.storage.save({
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
      });
    } catch (error) {
      // Annotate span with error status
      Effect.runPromise(
        withFredSpan('checkpoint.save.error', {
          runId: options.runId,
          workflowId: options.pipelineId,
          stepName: options.stepName,
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Get the latest checkpoint for a run (highest step number).
   *
   * @param runId - The run identifier
   * @returns The latest checkpoint or null if none exists
   */
  async getLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('checkpoint.get_latest', {
        runId,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      return await this.storage.getLatest(runId);
    } catch (error) {
      Effect.runPromise(
        withFredSpan('checkpoint.get_latest.error', {
          runId,
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Get a specific checkpoint by run ID and step.
   *
   * @param runId - The run identifier
   * @param step - The step number
   * @returns The checkpoint or null if not found
   */
  async getCheckpoint(runId: string, step: number): Promise<Checkpoint | null> {
    return this.storage.get(runId, step);
  }

  /**
   * Update the status of a checkpoint.
   *
   * @param runId - The run identifier
   * @param step - The step number
   * @param status - The new status
   */
  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('checkpoint.update_status', {
        runId,
        'checkpoint.step': step,
        'checkpoint.status': status,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      await this.storage.updateStatus(runId, step, status);
    } catch (error) {
      Effect.runPromise(
        withFredSpan('checkpoint.update_status.error', {
          runId,
          'checkpoint.step': step,
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Mark a run as completed.
   * Convenience method for updateStatus with 'completed' status.
   *
   * @param runId - The run identifier
   * @param step - The step number
   */
  async markCompleted(runId: string, step: number): Promise<void> {
    await this.storage.updateStatus(runId, step, 'completed');
  }

  /**
   * Mark a run as failed.
   * Convenience method for updateStatus with 'failed' status.
   *
   * @param runId - The run identifier
   * @param step - The step number
   */
  async markFailed(runId: string, step: number): Promise<void> {
    await this.storage.updateStatus(runId, step, 'failed');
  }

  /**
   * Delete all checkpoints for a run.
   * Useful for cleanup after successful completion.
   *
   * @param runId - The run identifier
   */
  async deleteRun(runId: string): Promise<void> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('checkpoint.delete_run', {
        runId,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      await this.storage.deleteRun(runId);
    } catch (error) {
      Effect.runPromise(
        withFredSpan('checkpoint.delete_run.error', {
          runId,
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Delete expired checkpoints.
   * Call this periodically for automatic cleanup.
   *
   * @returns The number of deleted checkpoints
   */
  async deleteExpired(): Promise<number> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('checkpoint.delete_expired', {})(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      const count = await this.storage.deleteExpired();

      // Log cleanup count
      Effect.runPromise(
        withFredSpan('checkpoint.delete_expired.complete', {
          'checkpoint.deleted_count': count,
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });

      return count;
    } catch (error) {
      Effect.runPromise(
        withFredSpan('checkpoint.delete_expired.error', {
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Close the underlying storage connection.
   * Call this when shutting down to release resources.
   */
  async close(): Promise<void> {
    await this.storage.close();
  }
}
