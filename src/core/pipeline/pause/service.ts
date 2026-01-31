/**
 * PauseService - Effect-based pause operations.
 *
 * Provides Effect-based API for querying and managing paused pipelines.
 * Depends on CheckpointService for storage access.
 */

import { Context, Effect, Layer } from 'effect';
import { CheckpointService } from '../checkpoint/service';
import type { CheckpointStorage } from '../checkpoint/types';
import type { PendingPause } from './types';
import {
  PauseNotFoundError,
  PauseExpiredError,
} from '../errors';

/**
 * PauseService interface.
 *
 * Provides Effect-based pause query operations with typed errors.
 */
export interface PauseService {
  /**
   * Get pending pause for a specific run.
   *
   * @param runId - The run identifier to check
   * @returns PendingPause or fails with PauseNotFoundError
   */
  getPendingPause(runId: string): Effect.Effect<PendingPause, PauseNotFoundError | PauseExpiredError>;

  /**
   * List all pending pauses across all runs.
   *
   * Queries checkpoints with status='paused' and filters out expired ones.
   *
   * @returns Array of pending pauses, sorted by createdAt descending (newest first)
   */
  listPendingPauses(): Effect.Effect<PendingPause[]>;

  /**
   * Check if a run has a pending pause.
   *
   * @param runId - The run identifier to check
   * @returns true if run is paused and not expired
   */
  hasPendingPause(runId: string): Effect.Effect<boolean>;
}

export const PauseService = Context.GenericTag<PauseService>(
  'PauseService'
);

/**
 * Implementation of PauseService.
 */
class PauseServiceImpl implements PauseService {
  constructor(private checkpointService: CheckpointService) {}

  getPendingPause(runId: string): Effect.Effect<PendingPause, PauseNotFoundError | PauseExpiredError> {
    const self = this;
    return Effect.gen(function* () {
      // Use CheckpointService to get latest checkpoint
      const checkpointOrError = yield* Effect.either(
        self.checkpointService.getLatestCheckpoint(runId)
      );

      if (checkpointOrError._tag === 'Left') {
        return yield* Effect.fail(new PauseNotFoundError({ runId }));
      }

      const checkpoint = checkpointOrError.right;

      // Check if paused
      if (checkpoint.status !== 'paused') {
        return yield* Effect.fail(new PauseNotFoundError({ runId }));
      }

      // Check if expired
      const now = new Date();
      if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
        return yield* Effect.fail(new PauseExpiredError({
          runId,
          expiresAt: checkpoint.expiresAt
        }));
      }

      // Validate pause metadata exists
      if (!checkpoint.pauseMetadata) {
        return yield* Effect.fail(new PauseNotFoundError({ runId }));
      }

      // Build PendingPause
      const pendingPause: PendingPause = {
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

      return pendingPause;
    });
  }

  listPendingPauses(): Effect.Effect<PendingPause[]> {
    const self = this;
    return Effect.gen(function* () {
      // Access storage through checkpointService
      const storage = yield* self.checkpointService.getStorage();

      // Get all paused checkpoints using Effect.async
      const checkpoints = yield* self.listByStatusEffect(storage, 'paused');

      const now = new Date();

      // Filter and map to PendingPause
      const pendingPauses: PendingPause[] = checkpoints
        .filter((cp) => {
          // Filter out expired
          if (cp.expiresAt && cp.expiresAt < now) {
            return false;
          }
          // Must have pause metadata
          return cp.pauseMetadata !== undefined;
        })
        .map((cp) => ({
          runId: cp.runId,
          pipelineId: cp.pipelineId,
          stepName: cp.stepName ?? `step-${cp.step}`,
          prompt: cp.pauseMetadata!.prompt,
          choices: cp.pauseMetadata!.choices,
          schema: cp.pauseMetadata!.schema,
          metadata: cp.pauseMetadata!.metadata,
          createdAt: cp.createdAt,
          expiresAt: cp.expiresAt,
        }));

      // Sort by createdAt descending (newest first)
      pendingPauses.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return pendingPauses;
    });
  }

  hasPendingPause(runId: string): Effect.Effect<boolean> {
    const self = this;
    return self.getPendingPause(runId).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false))
    );
  }

  /**
   * Effect-wrapped storage listByStatus operation
   */
  private listByStatusEffect(
    storage: CheckpointStorage,
    status: string
  ): Effect.Effect<any[]> {
    return Effect.async<any[]>((resume) => {
      storage.listByStatus(status as any)
        .then((checkpoints) => resume(Effect.succeed(checkpoints)))
        .catch((error) => resume(Effect.die(error)));
    });
  }
}

/**
 * Live layer providing PauseService (depends on CheckpointService)
 */
export const PauseServiceLive = Layer.effect(
  PauseService,
  Effect.gen(function* () {
    const checkpointService = yield* CheckpointService;
    return new PauseServiceImpl(checkpointService);
  })
);
