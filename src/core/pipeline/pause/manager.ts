/**
 * PauseManager - Query APIs for pending pauses.
 *
 * Provides getPendingPause(runId) and listPendingPauses() methods
 * for applications to check and display paused workflow requests.
 */

import { Effect } from 'effect';
import type { CheckpointManager } from '../checkpoint/manager';
import type { PendingPause } from './types';
import { withFredSpan } from '../../observability/otel';

/**
 * Options for creating a PauseManager.
 */
export interface PauseManagerOptions {
  /** CheckpointManager for storage access */
  checkpointManager: CheckpointManager;
}

/**
 * Manager for querying pending human input pauses.
 *
 * @example
 * const pauseManager = new PauseManager({ checkpointManager });
 *
 * // Check specific run
 * const pause = await pauseManager.getPendingPause('run-123');
 * if (pause) {
 *   console.log(`Awaiting: ${pause.prompt}`);
 * }
 *
 * // List all pending
 * const allPauses = await pauseManager.listPendingPauses();
 */
export class PauseManager {
  private checkpointManager: CheckpointManager;

  constructor(options: PauseManagerOptions) {
    this.checkpointManager = options.checkpointManager;
  }

  /**
   * Get pending pause for a specific run.
   *
   * @param runId - The run identifier to check
   * @returns PendingPause if run is paused, null otherwise
   */
  async getPendingPause(runId: string): Promise<PendingPause | null> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('pause.get_pending', {
        runId,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      const checkpoint = await this.checkpointManager.getLatestCheckpoint(runId);

      if (!checkpoint || checkpoint.status !== 'paused') {
        return null;
      }

      // Check if expired
      if (checkpoint.expiresAt && checkpoint.expiresAt < new Date()) {
        return null;
      }

      if (!checkpoint.pauseMetadata) {
        // Paused but no metadata - shouldn't happen, but handle gracefully
        console.warn(`[PauseManager] Checkpoint ${runId} is paused but has no pauseMetadata`);
        return null;
      }

      const pendingPause = {
        runId: checkpoint.runId,
        pipelineId: checkpoint.pipelineId,
        stepName: checkpoint.stepName ?? `step-${checkpoint.step}`,
        prompt: checkpoint.pauseMetadata.prompt,
        choices: checkpoint.pauseMetadata.choices,
        schema: checkpoint.pauseMetadata.schema,
        metadata: checkpoint.pauseMetadata.metadata,
        createdAt: checkpoint.createdAt,
        expiresAt: checkpoint.expiresAt,
      };

      // Annotate with pause details
      Effect.runPromise(
        withFredSpan('pause.get_pending.found', {
          runId,
          workflowId: checkpoint.pipelineId,
          stepName: checkpoint.stepName,
          pauseId: runId, // pauseId is the runId for pending pauses
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });

      return pendingPause;
    } catch (error) {
      Effect.runPromise(
        withFredSpan('pause.get_pending.error', {
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
   * List all pending pauses across all runs.
   *
   * Queries checkpoints with status='paused' and filters out expired ones.
   *
   * @returns Array of pending pauses, sorted by createdAt descending (newest first)
   */
  async listPendingPauses(): Promise<PendingPause[]> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('pause.list_pending', {})(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      // Use the storage's listByStatus method
      const storage = (this.checkpointManager as any).storage;
      if (!storage || typeof storage.listByStatus !== 'function') {
        console.warn('[PauseManager] Storage does not support listByStatus');
        return [];
      }

      const checkpoints = await storage.listByStatus('paused');
      const now = new Date();

      const pendingPauses: PendingPause[] = checkpoints
        .filter((cp: any) => {
          // Filter out expired
          if (cp.expiresAt && cp.expiresAt < now) {
            return false;
          }
          // Must have pause metadata
          return cp.pauseMetadata !== undefined;
        })
        .map((cp: any) => ({
          runId: cp.runId,
          pipelineId: cp.pipelineId,
          stepName: cp.stepName ?? `step-${cp.step}`,
          prompt: cp.pauseMetadata.prompt,
          choices: cp.pauseMetadata.choices,
          schema: cp.pauseMetadata.schema,
          metadata: cp.pauseMetadata.metadata,
          createdAt: cp.createdAt,
          expiresAt: cp.expiresAt,
        }));

      // Sort by createdAt descending (newest first)
      pendingPauses.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Annotate with count
      Effect.runPromise(
        withFredSpan('pause.list_pending.complete', {
          'pause.count': pendingPauses.length,
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });

      return pendingPauses;
    } catch (error) {
      Effect.runPromise(
        withFredSpan('pause.list_pending.error', {
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }

  /**
   * Check if a run has a pending pause.
   *
   * @param runId - The run identifier to check
   * @returns true if run is paused and not expired
   */
  async hasPendingPause(runId: string): Promise<boolean> {
    // Fire-and-forget span annotation
    Effect.runPromise(
      withFredSpan('pause.has_pending', {
        runId,
      })(Effect.void)
    ).catch(() => {
      // Ignore tracing errors
    });

    try {
      const pause = await this.getPendingPause(runId);
      const hasPause = pause !== null;

      // Annotate result
      Effect.runPromise(
        withFredSpan('pause.has_pending.result', {
          runId,
          'pause.has_pending': hasPause,
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });

      return hasPause;
    } catch (error) {
      Effect.runPromise(
        withFredSpan('pause.has_pending.error', {
          runId,
          'error.message': error instanceof Error ? error.message : String(error),
        })(Effect.void)
      ).catch(() => {
        // Ignore tracing errors
      });
      throw error;
    }
  }
}
