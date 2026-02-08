import { Effect } from 'effect';
import type { Tool } from '../tool/tool';
import type { EvalCheckpointArtifact, EvaluationArtifact } from './artifact';
import { TraceStorageService, type TraceStorageApi } from './storage';
import { buildReplayToolMocks } from './mock-tools';
import {
  deterministicReplayHash,
  deriveClockAdjustmentsFromOffsets,
  runEffectWithTestClock,
} from './test-clock';

export type ReplayMode = 'retry' | 'skip' | 'restart';

export interface ReplayOptions {
  fromCheckpoint?: number;
  mode?: ReplayMode;
}

export interface ReplayDependencies {
  storage: Pick<TraceStorageApi, 'get'>;
  runtime: ReplayRuntimeAdapter;
  configPath?: string;
}

export interface ReplayRuntimeAdapter {
  initializeFromConfig: (
    configPath: string,
    options: {
      toolExecutors?: Map<string, Tool['execute']>;
    }
  ) => Promise<void>;
  resumeFromCheckpoint: (input: ReplayResumeInput) => Effect.Effect<unknown> | Promise<unknown> | unknown;
}

export interface ReplayResumeInput {
  runId: string;
  pipelineId: string;
  mode: ReplayMode;
  checkpoint: EvalCheckpointArtifact;
  contextSnapshot: Record<string, unknown>;
  toolExecutors: Map<string, Tool['execute']>;
}

export interface ReplayResult {
  traceId: string;
  runId: string;
  checkpointStep: number;
  mode: ReplayMode;
  output: unknown;
  outputHash: string;
}

export class ReplayTraceNotFoundError extends Error {
  constructor(traceId: string) {
    super(`Replay trace not found for traceId "${traceId}".`);
    this.name = 'ReplayTraceNotFoundError';
  }
}

export class ReplayCheckpointNotFoundError extends Error {
  constructor(requestedCheckpoint: number, availableCheckpoints: ReadonlyArray<number>) {
    super(
      `Replay checkpoint ${requestedCheckpoint} not found in artifact. ` +
        `Available checkpoints: ${availableCheckpoints.join(', ') || 'none'}.`
    );
    this.name = 'ReplayCheckpointNotFoundError';
  }
}

function toEffect(
  value: Effect.Effect<unknown, unknown, never> | Promise<unknown> | unknown
): Effect.Effect<unknown, unknown, never> {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>;
  }

  if (value && typeof value === 'object' && 'then' in value && typeof value.then === 'function') {
    return Effect.promise(() => value as Promise<unknown>);
  }

  return Effect.succeed(value);
}

function selectCheckpoint(
  checkpoints: ReadonlyArray<EvalCheckpointArtifact>,
  fromCheckpoint?: number
): EvalCheckpointArtifact {
  if (checkpoints.length === 0) {
    throw new ReplayCheckpointNotFoundError(fromCheckpoint ?? -1, []);
  }

  const sorted = checkpoints.slice().sort((a, b) => a.step - b.step);

  if (fromCheckpoint === undefined) {
    const latest = sorted[sorted.length - 1];
    if (!latest) {
      throw new ReplayCheckpointNotFoundError(-1, []);
    }
    return latest;
  }

  const match = sorted.find((checkpoint) => checkpoint.step === fromCheckpoint);
  if (!match) {
    throw new ReplayCheckpointNotFoundError(
      fromCheckpoint,
      sorted.map((checkpoint) => checkpoint.step)
    );
  }
  return match;
}

function buildClockAdjustments(
  artifact: EvaluationArtifact,
  selectedCheckpointStep: number
): ReadonlyArray<number> {
  const offsets = artifact.toolCalls
    .filter((call) => call.stepIndex >= selectedCheckpointStep)
    .map((call) => call.timing.offsetMs + call.timing.durationMs);

  return deriveClockAdjustmentsFromOffsets(offsets);
}

async function loadArtifact(
  storage: Pick<TraceStorageApi, 'get'>,
  traceId: string
): Promise<EvaluationArtifact | undefined> {
  return Effect.runPromise(storage.get(traceId));
}

export function createReplayOrchestrator(deps: ReplayDependencies) {
  return {
    replay: async (traceId: string, options: ReplayOptions = {}): Promise<ReplayResult> => {
      const artifact = await loadArtifact(deps.storage, traceId);
      if (!artifact) {
        throw new ReplayTraceNotFoundError(traceId);
      }

      const checkpoint = selectCheckpoint(artifact.checkpoints, options.fromCheckpoint);
      const mode = options.mode ?? 'skip';
      const toolMocks = buildReplayToolMocks(artifact);

      // Only initialize from config if configPath is provided
      // For config-less replay, we rely on artifact data and checkpoint resumption
      if (deps.configPath) {
        await deps.runtime.initializeFromConfig(deps.configPath, {
          toolExecutors: toolMocks.toolExecutors,
        });
      }

      const clockAdjustments = buildClockAdjustments(artifact, checkpoint.step);
      const replayOutput = await runEffectWithTestClock(
        toEffect(
          deps.runtime.resumeFromCheckpoint({
            runId: artifact.run.runId,
            pipelineId: String(checkpoint.snapshot.pipelineId ?? ''),
            mode,
            checkpoint,
            contextSnapshot: checkpoint.snapshot,
            toolExecutors: toolMocks.toolExecutors,
          })
        ),
        clockAdjustments
      );

      toolMocks.assertConsumed();

      const result: ReplayResult = {
        traceId: artifact.traceId,
        runId: artifact.run.runId,
        checkpointStep: checkpoint.step,
        mode,
        output: replayOutput,
        outputHash: deterministicReplayHash({
          traceId: artifact.traceId,
          runId: artifact.run.runId,
          checkpointStep: checkpoint.step,
          mode,
          output: replayOutput,
        }),
      };

      return result;
    },
  };
}

export const replay = (
  traceId: string,
  options: ReplayOptions,
  dependencies: ReplayDependencies
): Promise<ReplayResult> => createReplayOrchestrator(dependencies).replay(traceId, options);

export const replayWithStorage = (
  traceId: string,
  options: ReplayOptions,
  runtime: ReplayRuntimeAdapter,
  configPath: string
): Effect.Effect<ReplayResult, Error, TraceStorageService> =>
  Effect.gen(function* () {
    const storage = yield* TraceStorageService;
    return yield* Effect.promise(() => replay(traceId, options, { storage, runtime, configPath }));
  });
