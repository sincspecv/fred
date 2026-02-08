import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { ObservabilityService, ObservabilityServiceLive } from '../../../../packages/core/src/observability/service';
import {
  EVAL_ARTIFACT_VERSION,
  stringifyEvaluationArtifact,
  validateEvaluationArtifact,
} from '../../../../packages/core/src/eval/artifact';
import {
  normalizeLegacyGoldenTrace,
  normalizeRunRecord,
} from '../../../../packages/core/src/eval/normalizer';
import { EvaluationService, EvaluationServiceLive } from '../../../../packages/core/src/eval/service';
import { FileTraceStorageLive, TraceStorageService } from '../../../../packages/core/src/eval/storage';
import type { GoldenTrace } from '../../../../packages/core/src/eval/golden-trace';

describe('evaluation recording determinism', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-recording-'));
  });

  afterEach(async () => {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  test('normalizes run records into canonical schema', async () => {
    const program = Effect.gen(function* () {
      const observability = yield* ObservabilityService;
      const evaluation = yield* EvaluationService;

      const runId = 'run-canonical-schema';
      yield* observability.startRun(runId);
      yield* observability.recordRunStepSpan(runId, {
        stepName: 'intent-route',
        startTime: 1000,
        endTime: 1050,
        status: 'success',
        metadata: {
          intentId: 'support.intent',
          traceId: 'volatile-trace-id',
          timestamp: 1000,
        },
      });
      yield* observability.recordRunToolUsage(runId, {
        toolId: 'search.docs',
        timestamp: 1030,
        durationMs: 15,
        inputHash: 'hash-input',
        outputHash: 'hash-output',
      });
      yield* observability.completeRun(runId);

      return yield* evaluation.record(runId, {
        message: 'How do I configure eval recording?',
        response: { content: 'Use fred.eval.record(runId).' },
        routing: {
          method: 'intent.matching',
          intentId: 'support.intent',
          agentId: 'support-agent',
          confidence: 0.98,
          matchType: 'semantic',
        },
        environment: {
          environment: 'test',
          fredVersion: '0.3.0-test',
          gitCommit: 'abc1234',
        },
      });
    });

    const dependencies = Layer.mergeAll(
      ObservabilityServiceLive,
      FileTraceStorageLive({ directory: tempDirectory })
    );
    const layer = Layer.mergeAll(
      dependencies,
      EvaluationServiceLive.pipe(Layer.provide(dependencies))
    );

    const artifact = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(artifact.version).toBe(EVAL_ARTIFACT_VERSION);
    expect(validateEvaluationArtifact(artifact)).toBe(true);
    expect(artifact.environment.environment).toBe('test');
    expect(artifact.environment.fredVersion).toBe('0.3.0-test');
    expect(artifact.environment.gitCommit).toBe('abc1234');
    expect(artifact.steps.length).toBe(1);
    expect(artifact.steps[0]?.metadata.traceId).toBeUndefined();
    expect(artifact.steps[0]?.metadata.timestamp).toBeUndefined();
  });

  test('derives stable ids and relative timings', async () => {
    const runRecord = {
      runId: 'run-stable-id',
      traceId: 'runtime-trace-id',
      startTime: 5000,
      endTime: 5200,
      hookEvents: [],
      stepSpans: [
        {
          stepName: 'step-0',
          startTime: 5000,
          endTime: 5100,
          status: 'success' as const,
          metadata: {},
        },
      ],
      toolUsage: [
        {
          toolId: 'calculator',
          timestamp: 5020,
          durationMs: 10,
        },
        {
          toolId: 'calculator',
          timestamp: 5030,
          durationMs: 12,
        },
      ],
      modelUsage: [],
      hasError: false,
      isSlow: false,
    };

    const artifact = normalizeRunRecord({
      runRecord,
      environment: {
        environment: 'test',
        fredVersion: '0.3.0',
      },
      message: '2 + 2',
      response: { content: '4' },
    });

    expect(artifact.steps[0]?.timing.offsetMs).toBe(0);
    expect(artifact.steps[0]?.timing.durationMs).toBe(100);
    expect(artifact.toolCalls[0]?.id).toBe('0:calculator:0');
    expect(artifact.toolCalls[1]?.id).toBe('0:calculator:1');
    expect(artifact.toolCalls[0]?.timing.offsetMs).toBe(20);
    expect(artifact.toolCalls[0]?.timing.durationMs).toBe(10);
  });

  test('converts legacy golden trace shape and strips wall-clock fields', () => {
    const legacyTrace: GoldenTrace = {
      version: '1.0',
      metadata: {
        timestamp: 1700000,
        fredVersion: '0.2.0',
        gitCommit: 'legacy-commit',
      },
      trace: {
        message: 'legacy message',
        spans: [
          {
            name: 'legacy-step',
            startTime: 1700000,
            endTime: 1700010,
            duration: 10,
            attributes: {
              traceId: 'volatile',
              timestamp: 1700000,
              value: 'kept',
            },
            events: [],
            status: { code: 'ok' },
          },
        ],
        response: { content: 'legacy response' },
        toolCalls: [
          {
            toolId: 'search',
            args: { q: 'fred' },
            result: { ok: true },
            timing: {
              startTime: 1700002,
              endTime: 1700004,
              duration: 2,
            },
            status: 'success',
          },
        ],
        handoffs: [],
        routing: {
          method: 'default.agent',
          agentId: 'fallback',
        },
      },
    };

    const artifact = normalizeLegacyGoldenTrace({
      trace: legacyTrace,
      runId: 'legacy-run',
      environment: {
        environment: 'test',
        fredVersion: '0.3.0',
        gitCommit: 'new-commit',
      },
    });

    expect(artifact.version).toBe(EVAL_ARTIFACT_VERSION);
    expect(artifact.steps[0]?.timing.offsetMs).toBe(0);
    expect(artifact.steps[0]?.metadata.attributes).toEqual({ value: 'kept' });
    expect(artifact.toolCalls[0]?.timing.offsetMs).toBe(2);
    expect(artifact.routing.agentId).toBe('fallback');
    expect(artifact.response.content).toBe('legacy response');
  });

  test('produces byte-stable artifacts for equivalent traces', () => {
    const sourceA: GoldenTrace = {
      version: '1.0',
      metadata: { timestamp: 100000, fredVersion: '0.2.0' },
      trace: {
        message: 'same behavior',
        spans: [
          {
            name: 'step-a',
            startTime: 100000,
            endTime: 100100,
            duration: 100,
            attributes: { traceId: 'volatile-a', timestamp: 100000 },
            events: [],
            status: { code: 'ok' },
          },
        ],
        response: { content: 'same output' },
        toolCalls: [
          {
            toolId: 'lookup',
            args: { id: 1 },
            result: { ok: true },
            timing: { startTime: 100020, endTime: 100040, duration: 20 },
            status: 'success',
          },
        ],
        handoffs: [],
        routing: { method: 'default.agent', agentId: 'agent' },
      },
    };

    const sourceB: GoldenTrace = {
      ...sourceA,
      metadata: { ...sourceA.metadata, timestamp: 200000 },
      trace: {
        ...sourceA.trace,
        spans: sourceA.trace.spans.map((span) => ({
          ...span,
          startTime: span.startTime + 100000,
          endTime: span.endTime + 100000,
          attributes: { ...span.attributes, traceId: 'volatile-b', spanId: 'volatile-span' },
        })),
        toolCalls: sourceA.trace.toolCalls.map((toolCall) => ({
          ...toolCall,
          timing: {
            startTime: toolCall.timing.startTime + 100000,
            endTime: toolCall.timing.endTime + 100000,
            duration: toolCall.timing.duration,
          },
        })),
      },
    };

    const normalizedA = normalizeLegacyGoldenTrace({
      trace: sourceA,
      runId: 'equivalent-run',
      environment: { environment: 'test', fredVersion: '0.3.0' },
    });
    const normalizedB = normalizeLegacyGoldenTrace({
      trace: sourceB,
      runId: 'equivalent-run',
      environment: { environment: 'test', fredVersion: '0.3.0' },
    });

    expect(stringifyEvaluationArtifact(normalizedA)).toBe(stringifyEvaluationArtifact(normalizedB));
  });

  test('stores and loads artifacts through TraceStorageService abstraction', async () => {
    const program = Effect.gen(function* () {
      const storage = yield* TraceStorageService;
      const artifact = normalizeLegacyGoldenTrace({
        trace: {
          version: '1.0',
          metadata: { timestamp: 1000, fredVersion: '0.2.0' },
          trace: {
            message: 'store me',
            spans: [],
            response: { content: 'ok' },
            toolCalls: [],
            handoffs: [],
            routing: { method: 'default.agent' },
          },
        },
        runId: 'storage-run',
        environment: { environment: 'ci', fredVersion: '0.3.0', gitCommit: 'abc' },
      });

      const traceId = yield* storage.save(artifact);
      const loaded = yield* storage.get(traceId);
      const list = yield* storage.list();

      return { traceId, loaded, list };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(FileTraceStorageLive({ directory: tempDirectory })))
    );

    expect(result.loaded?.traceId).toBe(result.traceId);
    expect(result.list.some((entry) => entry.traceId === result.traceId)).toBe(true);
  });
});
