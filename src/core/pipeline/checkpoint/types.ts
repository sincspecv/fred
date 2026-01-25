/**
 * Checkpoint storage types and interfaces.
 *
 * Defines the Checkpoint data structure and CheckpointStorage interface
 * for persisting pipeline execution state at step boundaries.
 */

import type { PipelineContext } from '../context';
import type { PauseMetadata } from '../pause/types';

/**
 * Checkpoint status values.
 * Transitions: pending -> in_progress -> completed/failed
 * Or: pending -> in_progress -> paused (awaiting human input)
 * Paused checkpoints can expire if TTL is set.
 */
export type CheckpointStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'expired';

/**
 * Checkpoint data structure.
 * Represents a snapshot of pipeline execution state at a step boundary.
 */
export interface Checkpoint {
  /** Unique run identifier (UUID or custom ID) */
  runId: string;

  /** Pipeline identifier */
  pipelineId: string;

  /** Step number (0-indexed) */
  step: number;

  /** Current status of this checkpoint */
  status: CheckpointStatus;

  /** Full pipeline context at this step */
  context: PipelineContext;

  /** When this checkpoint was created */
  createdAt: Date;

  /** When this checkpoint was last updated */
  updatedAt: Date;

  /** Optional expiration time for automatic cleanup */
  expiresAt?: Date;

  /** Step name for resilient resume (optional for backward compatibility) */
  stepName?: string;

  /** Pause metadata (only set when status is 'paused') */
  pauseMetadata?: PauseMetadata;
}

/**
 * Storage interface for checkpoint persistence.
 * Mirrors ContextStorage pattern from Phase 8.
 */
export interface CheckpointStorage {
  /**
   * Save a checkpoint (upsert by run_id + step).
   * @param checkpoint - The checkpoint to save
   */
  save(checkpoint: Checkpoint): Promise<void>;

  /**
   * Get the latest checkpoint for a run (highest step number).
   * @param runId - The run identifier
   * @returns The latest checkpoint or null if none exists
   */
  getLatest(runId: string): Promise<Checkpoint | null>;

  /**
   * Get a specific checkpoint by run_id and step.
   * @param runId - The run identifier
   * @param step - The step number
   * @returns The checkpoint or null if not found
   */
  get(runId: string, step: number): Promise<Checkpoint | null>;

  /**
   * Update the status of a checkpoint.
   * @param runId - The run identifier
   * @param step - The step number
   * @param status - The new status
   */
  updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void>;

  /**
   * Delete all checkpoints for a run.
   * @param runId - The run identifier
   */
  deleteRun(runId: string): Promise<void>;

  /**
   * Delete expired checkpoints (for cleanup task).
   * @returns The number of deleted checkpoints
   */
  deleteExpired(): Promise<number>;

  /**
   * List checkpoints by status (for querying pending pauses).
   * @param status - The status to filter by
   * @returns Array of checkpoints with the given status
   */
  listByStatus(status: CheckpointStatus): Promise<Checkpoint[]>;

  /**
   * Close connection pool/database.
   * Call this when shutting down to release resources.
   */
  close(): Promise<void>;
}
