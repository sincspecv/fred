import { Context, Data, Effect, Layer, Option } from 'effect';
import packageJson from '../../package.json';
import { ObservabilityService } from '../observability/service';
import { CheckpointService } from '../pipeline/checkpoint/service';
import type { Checkpoint, CheckpointStatus } from '../pipeline/checkpoint/types';
import type { EvalEnvironmentMetadata, EvalRoutingArtifact, EvaluationArtifact } from './artifact';
import { normalizeRunRecord } from './normalizer';
import { TraceStorageService } from './storage';

export class EvaluationRunNotFoundError extends Data.TaggedError('EvaluationRunNotFoundError')<{
  runId: string;
}> {}

export class EvaluationTraceNotFoundError extends Data.TaggedError('EvaluationTraceNotFoundError')<{
  traceId: string;
}> {}

export interface EvaluationRecordOptions {
  message?: string;
  response?: { content: string; role?: string; metadata?: Record<string, unknown> };
  routing?: EvalRoutingArtifact;
  environment?: Partial<EvalEnvironmentMetadata>;
}

export interface EvaluationServiceApi {
  record: (
    runId: string,
    options?: EvaluationRecordOptions
  ) => Effect.Effect<EvaluationArtifact, EvaluationRunNotFoundError | Error>;
  load: (traceId: string) => Effect.Effect<EvaluationArtifact, EvaluationTraceNotFoundError | Error>;
  list: () => Effect.Effect<ReadonlyArray<{ traceId: string; runId: string; version: string; environment: string }>, Error>;
}

export class EvaluationService extends Context.Tag('EvaluationService')<
  EvaluationService,
  EvaluationServiceApi
>() {}

async function listAllCheckpointsForRun(runId: string, checkpointService: CheckpointService): Promise<Checkpoint[]> {
  const storage = await Effect.runPromise(checkpointService.getStorage());
  const statuses: CheckpointStatus[] = [
    'pending',
    'in_progress',
    'completed',
    'failed',
    'paused',
    'expired',
  ];

  const checkpoints = (
    await Promise.all(statuses.map((status) => storage.listByStatus(status)))
  )
    .flat()
    .filter((checkpoint) => checkpoint.runId === runId)
    .sort((a, b) => {
      if (a.step === b.step) {
        return a.updatedAt.getTime() - b.updatedAt.getTime();
      }
      return a.step - b.step;
    });

  const deduped = new Map<string, Checkpoint>();
  for (const checkpoint of checkpoints) {
    deduped.set(`${checkpoint.step}:${checkpoint.status}`, checkpoint);
  }

  return [...deduped.values()];
}

export const EvaluationServiceLive = Layer.effect(
  EvaluationService,
  Effect.gen(function* () {
    const observability = yield* ObservabilityService;
    const storage = yield* TraceStorageService;
    const checkpointService = yield* Effect.serviceOption(CheckpointService);

    const defaultEnvironment = (): EvalEnvironmentMetadata => ({
      environment: process.env.NODE_ENV ?? 'development',
      fredVersion: packageJson.version,
      gitCommit: process.env.GIT_COMMIT,
      nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
      platform: typeof process !== 'undefined' ? process.platform : undefined,
    });

    return {
      record: (runId, options = {}) =>
        Effect.gen(function* () {
          const runRecord = yield* observability.exportTrace(runId);
          if (!runRecord) {
            return yield* Effect.fail(new EvaluationRunNotFoundError({ runId }));
          }

          const checkpoints =
            Option.isSome(checkpointService)
              ? yield* Effect.tryPromise({
                  try: () => listAllCheckpointsForRun(runId, checkpointService.value),
                  catch: (cause) => new Error(`Failed to load checkpoints: ${String(cause)}`),
                })
              : [];

          const artifact = normalizeRunRecord({
            runRecord,
            message: options.message,
            response: options.response,
            routing: options.routing,
            checkpoints: checkpoints.map((checkpoint) => ({
              step: checkpoint.step,
              stepName: checkpoint.stepName,
              status: checkpoint.status,
              createdAt: checkpoint.createdAt,
              snapshot: {
                pipelineId: checkpoint.pipelineId,
                context: checkpoint.context as unknown as Record<string, unknown>,
                pauseMetadata: checkpoint.pauseMetadata,
              },
            })),
            environment: {
              ...defaultEnvironment(),
              ...options.environment,
            },
          });

          yield* storage.save(artifact);
          return artifact;
        }),

      load: (traceId) =>
        Effect.gen(function* () {
          const artifact = yield* storage.get(traceId);
          if (!artifact) {
            return yield* Effect.fail(new EvaluationTraceNotFoundError({ traceId }));
          }
          return artifact;
        }),

      list: () => storage.list(),
    } satisfies EvaluationServiceApi;
  })
);
