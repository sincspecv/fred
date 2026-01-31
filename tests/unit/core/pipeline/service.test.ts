import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { PipelineService, PipelineServiceLive } from '../../../../src/core/pipeline/service';
import { AgentService, AgentServiceLive } from '../../../../src/core/agent/service';
import { HookManagerService, HookManagerServiceLive } from '../../../../src/core/hooks/service';
import { CheckpointService, CheckpointServiceLive } from '../../../../src/core/pipeline/checkpoint/service';
import { PauseService, PauseServiceLive } from '../../../../src/core/pipeline/pause/service';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../src/core/tool/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../src/core/platform/service';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from '../../../../src/core/pipeline/checkpoint/types';

/**
 * Create a mock CheckpointStorage for testing.
 */
function createMockStorage(): CheckpointStorage {
  const checkpoints: Checkpoint[] = [];

  return {
    async save(checkpoint: Checkpoint): Promise<void> {
      const existingIndex = checkpoints.findIndex(
        c => c.runId === checkpoint.runId && c.step === checkpoint.step
      );
      if (existingIndex >= 0) {
        checkpoints[existingIndex] = checkpoint;
      } else {
        checkpoints.push(checkpoint);
      }
    },

    async getLatest(runId: string): Promise<Checkpoint | null> {
      const filtered = checkpoints
        .filter(c => c.runId === runId)
        .sort((a, b) => b.step - a.step);
      return filtered[0] ?? null;
    },

    async get(runId: string, step: number): Promise<Checkpoint | null> {
      return checkpoints.find(c => c.runId === runId && c.step === step) ?? null;
    },

    async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
      const checkpoint = checkpoints.find(c => c.runId === runId && c.step === step);
      if (checkpoint) {
        checkpoint.status = status;
        checkpoint.updatedAt = new Date();
      }
    },

    async deleteRun(runId: string): Promise<void> {
      const toRemove = checkpoints.filter(c => c.runId === runId);
      for (const cp of toRemove) {
        const idx = checkpoints.indexOf(cp);
        if (idx >= 0) {
          checkpoints.splice(idx, 1);
        }
      }
    },

    async deleteExpired(): Promise<number> {
      const now = new Date();
      const expired = checkpoints.filter(c => c.expiresAt && c.expiresAt < now);
      for (const cp of expired) {
        const idx = checkpoints.indexOf(cp);
        if (idx >= 0) {
          checkpoints.splice(idx, 1);
        }
      }
      return expired.length;
    },

    async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
      return checkpoints.filter(c => c.status === status);
    },
  };
}

// Build complete layer stack
const TestLayer = PipelineServiceLive.pipe(
  Layer.provide(AgentServiceLive),
  Layer.provide(HookManagerServiceLive),
  Layer.provide(PauseServiceLive),
  Layer.provide(CheckpointServiceLive({ storage: createMockStorage() })),
  Layer.provide(ToolRegistryServiceLive),
  Layer.provide(ProviderRegistryServiceLive)
);

const runWithService = <A, E>(effect: Effect.Effect<A, E, PipelineService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

describe('PipelineService', () => {
  describe('hasPipeline', () => {
    test('returns false when no pipelines registered', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasPipeline('test-pipeline');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getPipeline', () => {
    test('fails with PipelineNotFoundError when not exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipeline('nonexistent');
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });
  });

  describe('getPipelineOptional', () => {
    test('returns undefined when not exists', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipelineOptional('nonexistent');
        })
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getAllPipelines', () => {
    test('returns empty array when no pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllPipelines();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('hasPipelineV2', () => {
    test('returns false when no V2 pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasPipelineV2('test-v2');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getAllPipelinesV2', () => {
    test('returns empty array when no V2 pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllPipelinesV2();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('hasGraphWorkflow', () => {
    test('returns false when no graph workflows', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasGraphWorkflow('test-graph');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getAllGraphWorkflows', () => {
    test('returns empty array when no graph workflows', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllGraphWorkflows();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('clear', () => {
    test('clears all pipeline types', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.clear();
          const pipelines = yield* service.getAllPipelines();
          const v2 = yield* service.getAllPipelinesV2();
          const graphs = yield* service.getAllGraphWorkflows();
          return { pipelines: pipelines.length, v2: v2.length, graphs: graphs.length };
        })
      );
      expect(result.pipelines).toBe(0);
      expect(result.v2).toBe(0);
      expect(result.graphs).toBe(0);
    });
  });

  describe('matchPipelineByUtterance', () => {
    test('returns null when no pipelines with utterances', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.matchPipelineByUtterance('hello');
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('getPauseService', () => {
    test('returns pause service', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPauseService();
        })
      );
      expect(result).toBeDefined();
    });
  });

  describe('createPipelineV2', () => {
    test('creates V2 pipeline successfully', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.createPipelineV2({
            id: 'test-pipeline-v2',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          });
          return yield* service.hasPipelineV2('test-pipeline-v2');
        })
      );
      expect(result).toBe(true);
    });

    test('fails when pipeline already exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.createPipelineV2({
            id: 'duplicate-pipeline',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          });
          // Try to create again
          yield* service.createPipelineV2({
            id: 'duplicate-pipeline',
            steps: [
              { name: 'step2', type: 'agent', agentId: 'test-agent2' }
            ]
          });
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });
  });

  describe('getPipelineV2', () => {
    test('retrieves V2 pipeline after creation', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          const config = {
            id: 'get-test-pipeline',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          };
          yield* service.createPipelineV2(config as any);
          const retrieved = yield* service.getPipelineV2('get-test-pipeline');
          return retrieved.id;
        })
      );
      expect(result).toBe('get-test-pipeline');
    });

    test('fails when pipeline not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipelineV2('nonexistent-v2');
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });
  });
});
