import { describe, expect, test } from 'bun:test';
import { Clock, Duration, Effect } from 'effect';
import type { EvaluationArtifact } from '../../../../packages/core/src/eval/artifact';
import {
  createReplayOrchestrator,
  ReplayCheckpointNotFoundError,
  type ReplayResumeInput,
} from '../../../../packages/core/src/eval/replay';

function makeArtifact(): EvaluationArtifact {
  return {
    version: '1.0',
    traceId: 'trace-replay',
    run: {
      runId: 'run-replay',
      hasError: false,
      isSlow: false,
    },
    environment: {
      environment: 'test',
      fredVersion: '0.3.0-test',
    },
    input: {
      message: 'replay me',
    },
    routing: {
      method: 'default.agent',
      agentId: 'default-agent',
    },
    response: {
      content: 'ok',
    },
    steps: [
      {
        id: 'step-0',
        index: 0,
        name: 'step-0',
        status: 'success',
        timing: { offsetMs: 0, durationMs: 5 },
        metadata: {},
      },
      {
        id: 'step-1',
        index: 1,
        name: 'step-1',
        status: 'success',
        timing: { offsetMs: 10, durationMs: 5 },
        metadata: {},
      },
      {
        id: 'step-2',
        index: 2,
        name: 'step-2',
        status: 'success',
        timing: { offsetMs: 20, durationMs: 5 },
        metadata: {},
      },
    ],
    toolCalls: [],
    checkpoints: [
      {
        id: 'checkpoint-0',
        step: 0,
        stepName: 'step-0',
        status: 'completed',
        timing: { offsetMs: 0, durationMs: 0 },
        snapshot: {
          pipelineId: 'pipeline-replay',
          context: { input: 'replay me' },
        },
      },
      {
        id: 'checkpoint-1',
        step: 1,
        stepName: 'step-1',
        status: 'completed',
        timing: { offsetMs: 10, durationMs: 0 },
        snapshot: {
          pipelineId: 'pipeline-replay',
          context: { input: 'replay me' },
        },
      },
      {
        id: 'checkpoint-2',
        step: 2,
        stepName: 'step-2',
        status: 'completed',
        timing: { offsetMs: 20, durationMs: 0 },
        snapshot: {
          pipelineId: 'pipeline-replay',
          context: { input: 'replay me' },
        },
      },
    ],
    handoffs: [],
  };
}

describe('evaluation replay', () => {
  test('replays from latest checkpoint when fromCheckpoint is omitted', async () => {
    const artifact = makeArtifact();
    const observed: Array<ReplayResumeInput> = [];

    const orchestrator = createReplayOrchestrator({
      storage: {
        get: () => Effect.succeed(artifact),
      },
      configPath: '/tmp/fred.yaml',
      runtime: {
        initializeFromConfig: async () => {
          return;
        },
        resumeFromCheckpoint: (input) => {
          observed.push(input);
          return Effect.succeed({ resumedFrom: input.checkpoint.step });
        },
      },
    });

    const result = await orchestrator.replay(artifact.traceId, {});

    expect(observed[0]?.checkpoint.step).toBe(2);
    expect(result.checkpointStep).toBe(2);
    expect(result.mode).toBe('skip');
  });

  test('replays from explicit intermediate checkpoint', async () => {
    const artifact = makeArtifact();
    let observedStep = -1;

    const orchestrator = createReplayOrchestrator({
      storage: {
        get: () => Effect.succeed(artifact),
      },
      configPath: '/tmp/fred.yaml',
      runtime: {
        initializeFromConfig: async () => {
          return;
        },
        resumeFromCheckpoint: (input) => {
          observedStep = input.checkpoint.step;
          return Effect.succeed({ resumedFrom: input.checkpoint.step });
        },
      },
    });

    const result = await orchestrator.replay(artifact.traceId, { fromCheckpoint: 1, mode: 'retry' });

    expect(observedStep).toBe(1);
    expect(result.checkpointStep).toBe(1);
    expect(result.mode).toBe('retry');
  });

  test('fails with actionable error when checkpoint does not exist', async () => {
    const artifact = makeArtifact();

    const orchestrator = createReplayOrchestrator({
      storage: {
        get: () => Effect.succeed(artifact),
      },
      configPath: '/tmp/fred.yaml',
      runtime: {
        initializeFromConfig: async () => {
          return;
        },
        resumeFromCheckpoint: () => Effect.succeed({}),
      },
    });

    await expect(orchestrator.replay(artifact.traceId, { fromCheckpoint: 99 })).rejects.toBeInstanceOf(
      ReplayCheckpointNotFoundError
    );
  });

  test('fails replay when a required mock tool response is missing', async () => {
    const artifact = makeArtifact();
    artifact.toolCalls = [
      {
        id: '0:lookup:0',
        toolId: 'lookup',
        stepIndex: 0,
        callOrdinal: 0,
        timing: { offsetMs: 0, durationMs: 1 },
        status: 'success',
        args: { query: 'fred' },
        result: { ok: true },
      },
    ];

    const orchestrator = createReplayOrchestrator({
      storage: {
        get: () => Effect.succeed(artifact),
      },
      configPath: '/tmp/fred.yaml',
      runtime: {
        initializeFromConfig: async () => {
          return;
        },
        resumeFromCheckpoint: (input) =>
          Effect.gen(function* () {
            const executor = input.toolExecutors.get('lookup');
            if (!executor) {
              throw new Error('lookup executor missing');
            }

            yield* Effect.promise(() => Promise.resolve(executor({ query: 'fred' })));
            yield* Effect.promise(() => Promise.resolve(executor({ query: 'fred' })));
            return { ok: true };
          }),
      },
    });

    await expect(orchestrator.replay(artifact.traceId, { fromCheckpoint: 0 })).rejects.toThrow(
      'missing recorded response for tool "lookup"'
    );
  });

  test('produces stable replay hashes with virtual time under TestClock', async () => {
    const artifact = makeArtifact();
    artifact.toolCalls = [
      {
        id: '0:delay:0',
        toolId: 'delay',
        stepIndex: 0,
        callOrdinal: 0,
        timing: { offsetMs: 0, durationMs: 2500 },
        status: 'success',
        args: { ms: 2000 },
        result: { accepted: true },
      },
    ];

    const orchestrator = createReplayOrchestrator({
      storage: {
        get: () => Effect.succeed(artifact),
      },
      configPath: '/tmp/fred.yaml',
      runtime: {
        initializeFromConfig: async () => {
          return;
        },
        resumeFromCheckpoint: (input) =>
          Effect.gen(function* () {
            const executor = input.toolExecutors.get('delay');
            if (!executor) {
              throw new Error('delay executor missing');
            }

            const mockResult = yield* Effect.promise(() => Promise.resolve(executor({ ms: 2000 })));
            yield* Effect.sleep(Duration.seconds(2));
            const virtualNow = yield* Clock.currentTimeMillis;

            return {
              mockResult,
              virtualNow,
            };
          }),
      },
    });

    const firstStart = Date.now();
    const first = await orchestrator.replay(artifact.traceId, { fromCheckpoint: 0, mode: 'skip' });
    const firstElapsedMs = Date.now() - firstStart;

    const secondStart = Date.now();
    const second = await orchestrator.replay(artifact.traceId, { fromCheckpoint: 0, mode: 'skip' });
    const secondElapsedMs = Date.now() - secondStart;

    expect(first.outputHash).toBe(second.outputHash);
    expect(firstElapsedMs).toBeLessThan(500);
    expect(secondElapsedMs).toBeLessThan(500);
  });
});
