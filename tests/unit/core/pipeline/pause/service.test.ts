import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { PauseService, PauseServiceLive } from '../../../../../packages/core/src/pipeline/pause/service';
import { CheckpointService, CheckpointServiceLive } from '../../../../../packages/core/src/pipeline/checkpoint/service';
import { PauseNotFoundError, PauseExpiredError } from '../../../../../packages/core/src/pipeline/errors';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from '../../../../../packages/core/src/pipeline/checkpoint/types';
import type { PipelineContext } from '../../../../../packages/core/src/pipeline/context';
import type { PauseMetadata } from '../../../../../packages/core/src/pipeline/pause/types';

/**
 * In-memory checkpoint storage for testing
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  async save(checkpoint: Checkpoint): Promise<void> {
    const runCheckpoints = this.checkpoints.get(checkpoint.runId) || [];
    const existing = runCheckpoints.findIndex(
      (cp) => cp.runId === checkpoint.runId && cp.step === checkpoint.step
    );

    if (existing >= 0) {
      runCheckpoints[existing] = checkpoint;
    } else {
      runCheckpoints.push(checkpoint);
    }

    runCheckpoints.sort((a, b) => a.step - b.step);
    this.checkpoints.set(checkpoint.runId, runCheckpoints);
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints || runCheckpoints.length === 0) return null;
    return runCheckpoints[runCheckpoints.length - 1];
  }

  async get(runId: string, step: number): Promise<Checkpoint | null> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints) return null;
    return runCheckpoints.find((cp) => cp.step === step) || null;
  }

  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints) return;

    const checkpoint = runCheckpoints.find((cp) => cp.step === step);
    if (checkpoint) {
      checkpoint.status = status;
      checkpoint.updatedAt = new Date();
    }
  }

  async deleteRun(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const [runId, checkpoints] of this.checkpoints.entries()) {
      const filtered = checkpoints.filter((cp) => {
        if (cp.expiresAt && cp.expiresAt < now) {
          count++;
          return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        this.checkpoints.delete(runId);
      } else {
        this.checkpoints.set(runId, filtered);
      }
    }

    return count;
  }

  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    const result: Checkpoint[] = [];
    for (const checkpoints of this.checkpoints.values()) {
      result.push(...checkpoints.filter((cp) => cp.status === status));
    }
    return result;
  }

  async close(): Promise<void> {
    this.checkpoints.clear();
  }
}

const createTestContext = (): PipelineContext => ({
  history: [],
  outputs: {},
  metadata: {},
});

const createTestPauseMetadata = (): PauseMetadata => ({
  prompt: 'Please provide input',
  resumeBehavior: 'continue',
});

const runWithService = <A, E>(effect: Effect.Effect<A, E, PauseService | CheckpointService>) => {
  const storage = new InMemoryCheckpointStorage();
  const checkpointLayer = CheckpointServiceLive({ storage });
  // Provide CheckpointService to PauseServiceLive, then merge both layers
  const pauseLayer = Layer.provide(PauseServiceLive, checkpointLayer);
  // Merge to provide both services
  const layer = Layer.merge(checkpointLayer, pauseLayer);
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
};

describe('PauseService', () => {
  describe('getPendingPause', () => {
    test('returns pending pause for paused run', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          // Create paused checkpoint
          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            stepName: 'user-input-step',
            pauseMetadata: createTestPauseMetadata(),
          });

          const pause = yield* pauseService.getPendingPause(runId);
          return pause;
        })
      );

      expect(result.runId).toBeDefined();
      expect(result.pipelineId).toBe('test-pipeline');
      expect(result.stepName).toBe('user-input-step');
      expect(result.prompt).toBe('Please provide input');
    });

    test('fails with PauseNotFoundError when run not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const pauseService = yield* PauseService;
          return yield* pauseService.getPendingPause('nonexistent-run');
        }).pipe(
          Effect.provide(
            Layer.provide(
              PauseServiceLive,
              CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })
            )
          )
        )
      );

      expect(result._tag).toBe('Failure');
    });

    test('fails with PauseNotFoundError when checkpoint is not paused', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          // Create completed checkpoint (not paused)
          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'completed',
            context: createTestContext(),
          });

          return yield* pauseService.getPendingPause(runId);
        }).pipe(
          Effect.provide(
            Layer.provide(
              PauseServiceLive,
              CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })
            )
          )
        )
      );

      expect(result._tag).toBe('Failure');
    });

    test('fails with PauseExpiredError when pause has expired', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          // Create expired pause
          const pastDate = new Date(Date.now() - 1000);
          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: createTestPauseMetadata(),
            expiresAt: pastDate,
          });

          return yield* pauseService.getPendingPause(runId);
        }).pipe(
          Effect.provide(
            Layer.provide(
              PauseServiceLive,
              CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })
            )
          )
        )
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('listPendingPauses', () => {
    test('returns all non-expired pending pauses', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;

          // Create three paused checkpoints
          const runId1 = yield* checkpointService.generateRunId();
          const runId2 = yield* checkpointService.generateRunId();
          const runId3 = yield* checkpointService.generateRunId();

          yield* checkpointService.saveCheckpoint({
            runId: runId1,
            pipelineId: 'pipeline-1',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: { ...createTestPauseMetadata(), prompt: 'Prompt 1' },
          });

          yield* checkpointService.saveCheckpoint({
            runId: runId2,
            pipelineId: 'pipeline-2',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: { ...createTestPauseMetadata(), prompt: 'Prompt 2' },
          });

          // Create an expired pause
          const pastDate = new Date(Date.now() - 1000);
          yield* checkpointService.saveCheckpoint({
            runId: runId3,
            pipelineId: 'pipeline-3',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: { ...createTestPauseMetadata(), prompt: 'Prompt 3 (expired)' },
            expiresAt: pastDate,
          });

          const pauses = yield* pauseService.listPendingPauses();
          return pauses;
        })
      );

      expect(result.length).toBe(2);
      expect(result.map(p => p.pipelineId).sort()).toEqual(['pipeline-1', 'pipeline-2']);
    });

    test('returns empty array when no pending pauses', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const pauseService = yield* PauseService;
          return yield* pauseService.listPendingPauses();
        })
      );

      expect(result).toEqual([]);
    });

    test('sorts pauses by createdAt descending', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;

          const runId1 = yield* checkpointService.generateRunId();
          const runId2 = yield* checkpointService.generateRunId();

          // Create first pause
          yield* checkpointService.saveCheckpoint({
            runId: runId1,
            pipelineId: 'pipeline-1',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: createTestPauseMetadata(),
          });

          // Wait a bit using Effect
          yield* Effect.tryPromise({
            try: () => new Promise(resolve => setTimeout(resolve, 10)),
            catch: (error) => error,
          });

          // Create second pause (should be newer)
          yield* checkpointService.saveCheckpoint({
            runId: runId2,
            pipelineId: 'pipeline-2',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: createTestPauseMetadata(),
          });

          const pauses = yield* pauseService.listPendingPauses();
          return pauses;
        })
      );

      expect(result.length).toBe(2);
      expect(result[0].pipelineId).toBe('pipeline-2'); // Newer first
      expect(result[1].pipelineId).toBe('pipeline-1');
    });
  });

  describe('hasPendingPause', () => {
    test('returns true when run has pending pause', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: createTestPauseMetadata(),
          });

          return yield* pauseService.hasPendingPause(runId);
        })
      );

      expect(result).toBe(true);
    });

    test('returns false when run has no pending pause', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'completed',
            context: createTestContext(),
          });

          return yield* pauseService.hasPendingPause(runId);
        })
      );

      expect(result).toBe(false);
    });

    test('returns false when run does not exist', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const pauseService = yield* PauseService;
          return yield* pauseService.hasPendingPause('nonexistent-run');
        })
      );

      expect(result).toBe(false);
    });

    test('returns false when pause has expired', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const checkpointService = yield* CheckpointService;
          const pauseService = yield* PauseService;
          const runId = yield* checkpointService.generateRunId();

          const pastDate = new Date(Date.now() - 1000);
          yield* checkpointService.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'paused',
            context: createTestContext(),
            pauseMetadata: createTestPauseMetadata(),
            expiresAt: pastDate,
          });

          return yield* pauseService.hasPendingPause(runId);
        })
      );

      expect(result).toBe(false);
    });
  });
});
