import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  CheckpointManager,
  type CheckpointManagerOptions,
  type SaveCheckpointOptions,
} from '../../../../../src/core/pipeline/checkpoint/manager';
import type {
  CheckpointStorage,
  Checkpoint,
  CheckpointStatus,
} from '../../../../../src/core/pipeline/checkpoint/types';
import type { PipelineContext } from '../../../../../src/core/pipeline/context';

/**
 * Create a mock CheckpointStorage for testing.
 */
function createMockStorage(): CheckpointStorage & {
  savedCheckpoints: Checkpoint[];
  statusUpdates: Array<{ runId: string; step: number; status: CheckpointStatus }>;
} {
  const savedCheckpoints: Checkpoint[] = [];
  const statusUpdates: Array<{ runId: string; step: number; status: CheckpointStatus }> = [];

  return {
    savedCheckpoints,
    statusUpdates,

    async save(checkpoint: Checkpoint): Promise<void> {
      // Upsert by runId + step
      const existingIndex = savedCheckpoints.findIndex(
        c => c.runId === checkpoint.runId && c.step === checkpoint.step
      );
      if (existingIndex >= 0) {
        savedCheckpoints[existingIndex] = checkpoint;
      } else {
        savedCheckpoints.push(checkpoint);
      }
    },

    async getLatest(runId: string): Promise<Checkpoint | null> {
      const checkpoints = savedCheckpoints
        .filter(c => c.runId === runId)
        .sort((a, b) => b.step - a.step);
      return checkpoints[0] ?? null;
    },

    async get(runId: string, step: number): Promise<Checkpoint | null> {
      return savedCheckpoints.find(c => c.runId === runId && c.step === step) ?? null;
    },

    async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
      statusUpdates.push({ runId, step, status });
      const checkpoint = savedCheckpoints.find(c => c.runId === runId && c.step === step);
      if (checkpoint) {
        checkpoint.status = status;
        checkpoint.updatedAt = new Date();
      }
    },

    async deleteRun(runId: string): Promise<void> {
      const toRemove = savedCheckpoints.filter(c => c.runId === runId);
      for (const cp of toRemove) {
        const idx = savedCheckpoints.indexOf(cp);
        if (idx >= 0) {
          savedCheckpoints.splice(idx, 1);
        }
      }
    },

    async deleteExpired(): Promise<number> {
      const now = new Date();
      const expired = savedCheckpoints.filter(c => c.expiresAt && c.expiresAt < now);
      for (const cp of expired) {
        const idx = savedCheckpoints.indexOf(cp);
        if (idx >= 0) {
          savedCheckpoints.splice(idx, 1);
        }
      }
      return expired.length;
    },

    async close(): Promise<void> {
      // No-op for mock
    },
  };
}

/**
 * Create a mock PipelineContext for testing.
 */
function createMockContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: 'test input',
    outputs: {},
    history: [],
    metadata: {},
    pipelineId: 'test-pipeline',
    conversationId: 'conv-1',
    ...overrides,
  };
}

describe('CheckpointManager', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let manager: CheckpointManager;

  beforeEach(() => {
    storage = createMockStorage();
    manager = new CheckpointManager({ storage });
  });

  describe('generateRunId', () => {
    test('should produce valid UUID format', () => {
      const runId = manager.generateRunId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(runId).toMatch(uuidRegex);
    });

    test('should produce unique IDs on consecutive calls', () => {
      const id1 = manager.generateRunId();
      const id2 = manager.generateRunId();
      const id3 = manager.generateRunId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe('saveCheckpoint', () => {
    test('should save checkpoint with default TTL', async () => {
      const context = createMockContext();
      const beforeSave = new Date();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
      });

      expect(storage.savedCheckpoints).toHaveLength(1);
      const saved = storage.savedCheckpoints[0];

      expect(saved.runId).toBe('run-1');
      expect(saved.pipelineId).toBe('pipeline-1');
      expect(saved.step).toBe(0);
      expect(saved.status).toBe('pending');
      expect(saved.context).toEqual(context);
      expect(saved.createdAt.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
      expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());

      // Default TTL is 7 days
      const expectedExpiry = beforeSave.getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(saved.expiresAt?.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(saved.expiresAt?.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    test('should save checkpoint with custom expiresAt', async () => {
      const context = createMockContext();
      const customExpiry = new Date(Date.now() + 3600000); // 1 hour from now

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
        expiresAt: customExpiry,
      });

      expect(storage.savedCheckpoints).toHaveLength(1);
      const saved = storage.savedCheckpoints[0];

      expect(saved.expiresAt?.getTime()).toBe(customExpiry.getTime());
    });

    test('should use custom default TTL from constructor options', async () => {
      const customTtlMs = 24 * 60 * 60 * 1000; // 1 day
      const customManager = new CheckpointManager({
        storage,
        defaultTtlMs: customTtlMs,
      });

      const context = createMockContext();
      const beforeSave = new Date();

      await customManager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
      });

      const saved = storage.savedCheckpoints[0];
      const expectedExpiry = beforeSave.getTime() + customTtlMs;
      expect(saved.expiresAt?.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(saved.expiresAt?.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
    });
  });

  describe('getLatestCheckpoint', () => {
    test('should return null for missing run', async () => {
      const result = await manager.getLatestCheckpoint('nonexistent-run');
      expect(result).toBeNull();
    });

    test('should return latest checkpoint by step number', async () => {
      const context = createMockContext();

      // Save checkpoints for steps 0, 1, 2
      for (let step = 0; step < 3; step++) {
        await manager.saveCheckpoint({
          runId: 'run-1',
          pipelineId: 'pipeline-1',
          step,
          status: 'completed',
          context: { ...context, outputs: { [`step-${step}`]: `output-${step}` } },
        });
      }

      const latest = await manager.getLatestCheckpoint('run-1');

      expect(latest).not.toBeNull();
      expect(latest?.step).toBe(2);
      expect(latest?.context.outputs).toEqual({ 'step-2': 'output-2' });
    });
  });

  describe('getCheckpoint', () => {
    test('should return specific checkpoint by runId and step', async () => {
      const context = createMockContext();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'completed',
        context: { ...context, outputs: { step0: 'result0' } },
      });

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 1,
        status: 'completed',
        context: { ...context, outputs: { step1: 'result1' } },
      });

      const checkpoint = await manager.getCheckpoint('run-1', 0);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.step).toBe(0);
      expect(checkpoint?.context.outputs).toEqual({ step0: 'result0' });
    });

    test('should return null for nonexistent step', async () => {
      const context = createMockContext();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'completed',
        context,
      });

      const checkpoint = await manager.getCheckpoint('run-1', 5);
      expect(checkpoint).toBeNull();
    });
  });

  describe('updateStatus', () => {
    test('should update checkpoint status', async () => {
      const context = createMockContext();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
      });

      await manager.updateStatus('run-1', 0, 'in_progress');

      expect(storage.statusUpdates).toHaveLength(1);
      expect(storage.statusUpdates[0]).toEqual({
        runId: 'run-1',
        step: 0,
        status: 'in_progress',
      });

      const checkpoint = await manager.getCheckpoint('run-1', 0);
      expect(checkpoint?.status).toBe('in_progress');
    });
  });

  describe('markCompleted', () => {
    test('should set status to completed', async () => {
      const context = createMockContext();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'in_progress',
        context,
      });

      await manager.markCompleted('run-1', 0);

      const checkpoint = await manager.getCheckpoint('run-1', 0);
      expect(checkpoint?.status).toBe('completed');
    });
  });

  describe('markFailed', () => {
    test('should set status to failed', async () => {
      const context = createMockContext();

      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'in_progress',
        context,
      });

      await manager.markFailed('run-1', 0);

      const checkpoint = await manager.getCheckpoint('run-1', 0);
      expect(checkpoint?.status).toBe('failed');
    });
  });

  describe('deleteRun', () => {
    test('should delete all checkpoints for a run', async () => {
      const context = createMockContext();

      // Save multiple checkpoints for same run
      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'completed',
        context,
      });
      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 1,
        status: 'completed',
        context,
      });

      // Save checkpoint for different run
      await manager.saveCheckpoint({
        runId: 'run-2',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
      });

      expect(storage.savedCheckpoints).toHaveLength(3);

      await manager.deleteRun('run-1');

      expect(storage.savedCheckpoints).toHaveLength(1);
      expect(storage.savedCheckpoints[0].runId).toBe('run-2');
    });
  });

  describe('deleteExpired', () => {
    test('should delete expired checkpoints and return count', async () => {
      const context = createMockContext();

      // Save expired checkpoint
      const pastDate = new Date(Date.now() - 1000);
      await manager.saveCheckpoint({
        runId: 'run-1',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'completed',
        context,
        expiresAt: pastDate,
      });

      // Save non-expired checkpoint
      const futureDate = new Date(Date.now() + 86400000);
      await manager.saveCheckpoint({
        runId: 'run-2',
        pipelineId: 'pipeline-1',
        step: 0,
        status: 'pending',
        context,
        expiresAt: futureDate,
      });

      expect(storage.savedCheckpoints).toHaveLength(2);

      const deletedCount = await manager.deleteExpired();

      expect(deletedCount).toBe(1);
      expect(storage.savedCheckpoints).toHaveLength(1);
      expect(storage.savedCheckpoints[0].runId).toBe('run-2');
    });
  });

  describe('close', () => {
    test('should close underlying storage', async () => {
      let closeCalled = false;
      const closableStorage: CheckpointStorage = {
        ...storage,
        async close() {
          closeCalled = true;
        },
      };

      const mgr = new CheckpointManager({ storage: closableStorage });
      await mgr.close();

      expect(closeCalled).toBe(true);
    });
  });

  describe('DEFAULT_TTL_MS', () => {
    test('should be 7 days in milliseconds', () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(CheckpointManager.DEFAULT_TTL_MS).toBe(sevenDaysMs);
    });
  });
});
