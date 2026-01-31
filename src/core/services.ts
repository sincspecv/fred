/**
 * Fred Service Composition
 *
 * This module provides the aggregate FredLayers layer that composes all
 * Effect services, plus runtime creation utilities.
 */

import { Effect, Layer, Runtime, Scope, Ref } from 'effect';

// Import all services
import { ToolRegistryService, ToolRegistryServiceLive } from './tool/service';
import { HookManagerService, HookManagerServiceLive } from './hooks/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from './platform/service';
import { ContextStorageService, ContextStorageServiceLive } from './context/service';
import { AgentService, AgentServiceLive } from './agent/service';
import { CheckpointService } from './pipeline/checkpoint/service';
import { PauseService, PauseServiceLive } from './pipeline/pause/service';
import { PipelineService, PipelineServiceLive } from './pipeline/service';
import { MessageProcessorService, MessageProcessorServiceLive } from './message-processor/service';
import { IntentMatcherService, IntentMatcherServiceLive } from './intent/service';
import { IntentRouterService, IntentRouterServiceLive } from './intent/service';
import { MessageRouterService, MessageRouterServiceFromInstance } from './routing/service';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './pipeline/checkpoint/types';

/**
 * All Fred service types combined
 */
export type FredServices =
  | ToolRegistryService
  | HookManagerService
  | ProviderRegistryService
  | ContextStorageService
  | AgentService
  | CheckpointService
  | PauseService
  | PipelineService
  | MessageProcessorService
  | IntentMatcherService
  | IntentRouterService
  | MessageRouterService;

/**
 * Fred runtime type with all services
 */
export type FredRuntime = Runtime.Runtime<FredServices>;

/**
 * In-memory checkpoint storage for default layer composition
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints = new Map<string, Checkpoint[]>();

  async save(checkpoint: Checkpoint): Promise<void> {
    const key = checkpoint.runId;
    const existing = this.checkpoints.get(key) || [];
    // Remove any existing checkpoint at the same step
    const filtered = existing.filter((cp) => cp.step !== checkpoint.step);
    filtered.push(checkpoint);
    this.checkpoints.set(key, filtered);
  }

  async get(runId: string, step: number): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    return checkpoints?.find((cp) => cp.step === step) || null;
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints || checkpoints.length === 0) return null;
    return checkpoints.reduce((latest, cp) =>
      cp.step > latest.step ? cp : latest
    );
  }

  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (checkpoints) {
      const checkpoint = checkpoints.find((cp) => cp.step === step);
      if (checkpoint) {
        checkpoint.status = status;
        checkpoint.updatedAt = new Date();
      }
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
      for (const cp of checkpoints) {
        if (cp.status === status) {
          result.push(cp);
        }
      }
    }
    return result;
  }

  async close(): Promise<void> {
    this.checkpoints.clear();
  }
}

/**
 * Default in-memory CheckpointService layer
 */
const inMemoryStorage = new InMemoryCheckpointStorage();
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    const defaultTtlMs = yield* Ref.make(DEFAULT_TTL_MS);
    return {
      generateRunId: () => Effect.sync(() => crypto.randomUUID()),

      saveCheckpoint: (options) =>
        Effect.gen(function* () {
          const now = new Date();
          const ttl = yield* Ref.get(defaultTtlMs);
          const expiresAt = options.expiresAt ?? new Date(now.getTime() + ttl);
          yield* Effect.promise(() =>
            inMemoryStorage.save({
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
            })
          );
        }),

      getLatestCheckpoint: (runId) =>
        Effect.gen(function* () {
          const checkpoint = yield* Effect.promise(() => inMemoryStorage.getLatest(runId));
          if (!checkpoint) {
            return yield* Effect.fail({ _tag: 'CheckpointNotFoundError' as const, runId });
          }
          return checkpoint;
        }),

      getCheckpoint: (runId, step) =>
        Effect.gen(function* () {
          const checkpoint = yield* Effect.promise(() => inMemoryStorage.get(runId, step));
          if (!checkpoint) {
            return yield* Effect.fail({ _tag: 'CheckpointNotFoundError' as const, runId, step });
          }
          return checkpoint;
        }),

      updateStatus: (runId, step, status) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, status)),

      markCompleted: (runId, step) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, 'completed')),

      markFailed: (runId, step) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, 'failed')),

      deleteRun: (runId) => Effect.promise(() => inMemoryStorage.deleteRun(runId)),

      deleteExpired: () => Effect.promise(() => inMemoryStorage.deleteExpired()),

      getStorage: () => Effect.succeed(inMemoryStorage),
    } as CheckpointService;
  })
);

/**
 * Base layers with no external dependencies
 * Wave 1: ToolRegistry, HookManager
 */
const baseLayer = Layer.mergeAll(
  ToolRegistryServiceLive,
  HookManagerServiceLive
);

/**
 * Core infrastructure layers
 * Wave 2: ProviderRegistry, ContextStorage, Checkpoint
 */
const coreLayer = Layer.mergeAll(
  ProviderRegistryServiceLive,
  ContextStorageServiceLive,
  CheckpointServiceLive
);

/**
 * Pause layer depends on Checkpoint
 */
const pauseLayer = PauseServiceLive.pipe(
  Layer.provide(CheckpointServiceLive)
);

/**
 * Agent layer depends on Tool and Provider
 * Wave 3: AgentService
 */
const agentLayer = AgentServiceLive.pipe(
  Layer.provide(baseLayer),
  Layer.provide(ProviderRegistryServiceLive)
);

/**
 * Pipeline layer depends on Agent, Hook, Checkpoint, Pause
 * Wave 4: PipelineService
 */
const pipelineLayer = PipelineServiceLive.pipe(
  Layer.provide(agentLayer),
  Layer.provide(HookManagerServiceLive),
  Layer.provide(CheckpointServiceLive),
  Layer.provide(pauseLayer)
);

/**
 * MessageProcessor layer depends on Agent, Pipeline, Context
 * Wave 5: MessageProcessorService
 *
 * Note: Optional services (IntentMatcherService, IntentRouterService, MessageRouterService)
 * can be provided separately when needed. These wrap non-Effect classes and are typically
 * configured by the Fred orchestrator class.
 */
const messageProcessorLayer = MessageProcessorServiceLive.pipe(
  Layer.provide(agentLayer),
  Layer.provide(pipelineLayer),
  Layer.provide(ContextStorageServiceLive)
);

/**
 * Complete Fred layers - all services composed
 *
 * Dependency graph:
 * ```
 * ToolRegistryService (Wave 1)
 * HookManagerService (Wave 1)
 *       |
 *       v
 * ProviderRegistryService (Wave 2)
 * ContextStorageService (Wave 2)
 * CheckpointService (Wave 2)
 *       |
 *       v
 * PauseService (Wave 2.5 - depends on Checkpoint)
 *       |
 *       v
 * AgentService (Wave 3 - depends on Tool, Provider)
 *       |
 *       v
 * PipelineService (Wave 4 - depends on Agent, Hook, Checkpoint, Pause)
 *       |
 *       v
 * MessageProcessorService (Wave 5 - depends on Agent, Pipeline, Context)
 * ```
 */
export const FredLayers = Layer.mergeAll(
  baseLayer,
  coreLayer,
  pauseLayer,
  agentLayer,
  pipelineLayer,
  messageProcessorLayer
);

/**
 * Create a Fred runtime with all services.
 *
 * The runtime is scoped and will clean up resources when the scope closes.
 * Use this for applications that need long-running Fred instances.
 *
 * @example
 * ```typescript
 * const runtime = await createFredRuntime();
 *
 * // Use runtime to run Effects
 * const result = await Effect.runPromise(
 *   myEffect.pipe(Effect.provide(runtime))
 * );
 * ```
 */
export const createFredRuntime = (): Effect.Effect<FredRuntime, never, Scope.Scope> => {
  return Layer.toRuntime(FredLayers);
};

/**
 * Create a scoped Fred runtime that auto-cleans up.
 *
 * @example
 * ```typescript
 * const runtime = await createScopedFredRuntime();
 * // runtime is ready to use
 * // cleanup happens when process exits
 * ```
 */
export const createScopedFredRuntime = (): Promise<FredRuntime> => {
  return Effect.runPromise(
    Effect.scoped(createFredRuntime())
  );
};

// Re-export all services for convenience
export {
  ToolRegistryService,
  ToolRegistryServiceLive,
  HookManagerService,
  HookManagerServiceLive,
  ProviderRegistryService,
  ProviderRegistryServiceLive,
  ContextStorageService,
  ContextStorageServiceLive,
  AgentService,
  AgentServiceLive,
  CheckpointService,
  CheckpointServiceLive,
  PauseService,
  PauseServiceLive,
  PipelineService,
  PipelineServiceLive,
  MessageProcessorService,
  MessageProcessorServiceLive,
  IntentMatcherService,
  IntentMatcherServiceLive,
  IntentRouterService,
  IntentRouterServiceLive,
  MessageRouterService,
  MessageRouterServiceFromInstance,
};
