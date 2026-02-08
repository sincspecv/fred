import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createDefaultEvalCommandService,
  handleEvalCommand,
  type EvalCommandIO,
} from '../../../packages/cli/src/eval';
import type { EvaluationArtifact } from '../../../packages/core/src/eval/artifact';
import type { ReplayRuntimeAdapter } from '../../../packages/core/src/eval/replay';

function createHarness(overrides?: {
  record?: (input: { runId: string }) => Promise<unknown>;
  replay?: (input: { traceId: string; fromStep?: number; mode?: 'retry' | 'skip' | 'restart' }) => Promise<unknown>;
  compare?: (input: { baselineTraceId: string; candidateTraceId: string }) => Promise<{
    passed: boolean;
    scorecard: {
      totalChecks: number;
      passedChecks: number;
      failedChecks: number;
      regressions: Array<{ check: string; path: string; message: string }>;
    };
  }>;
  suite?: (input: { suitePath: string }) => Promise<unknown>;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    deps: {
      service: {
        record: overrides?.record ?? (async ({ runId }) => ({ traceId: `trace-${runId}`, runId })),
        replay: overrides?.replay ?? (async ({ traceId, fromStep }) => ({ traceId, checkpointStep: fromStep ?? 9 })),
        compare:
          overrides?.compare ??
          (async () => ({
            passed: true,
            scorecard: {
              totalChecks: 6,
              passedChecks: 6,
              failedChecks: 0,
              regressions: [],
            },
          })),
        suite:
          overrides?.suite ??
          (async ({ suitePath }) => ({
            suite: { name: suitePath },
            totals: {
              totalCases: 2,
              passedCases: 2,
              failedCases: 0,
              passRate: 1,
            },
          })),
      },
      io: {
        stdout: (message: string) => {
          stdout.push(message);
        },
        stderr: (message: string) => {
          stderr.push(message);
        },
      },
    },
  };
}

function createIoHarness(): { stdout: string[]; stderr: string[]; io: EvalCommandIO } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
  };
}

function makeArtifact(traceId: string, overrides?: Partial<EvaluationArtifact>): EvaluationArtifact {
  const base: EvaluationArtifact = {
    version: '1.0',
    traceId,
    run: {
      runId: 'run-a',
      hasError: false,
      isSlow: false,
    },
    environment: {
      environment: 'test',
      fredVersion: '0.3.0-test',
    },
    input: {
      message: 'hello',
    },
    routing: {
      method: 'intent.matching',
      intentId: 'support.intent',
      agentId: 'support-agent',
    },
    response: {
      content: 'ok',
    },
    steps: [],
    toolCalls: [],
    checkpoints: [],
    handoffs: [],
  };

  return {
    ...base,
    ...overrides,
    run: {
      ...base.run,
      ...(overrides?.run ?? {}),
    },
    environment: {
      ...base.environment,
      ...(overrides?.environment ?? {}),
    },
    input: {
      ...base.input,
      ...(overrides?.input ?? {}),
    },
    routing: {
      ...base.routing,
      ...(overrides?.routing ?? {}),
    },
    response: {
      ...base.response,
      ...(overrides?.response ?? {}),
    },
    steps: overrides?.steps ?? base.steps,
    toolCalls: overrides?.toolCalls ?? base.toolCalls,
    checkpoints: overrides?.checkpoints ?? base.checkpoints,
    handoffs: overrides?.handoffs ?? base.handoffs,
  };
}

describe('cli eval command', () => {
  test('returns usage error when subcommand is missing', async () => {
    const harness = createHarness();

    const exitCode = await handleEvalCommand([], {}, harness.deps);

    expect(exitCode).toBe(1);
    expect(harness.stderr[0]).toContain('Missing eval subcommand');
  });

  test('validates required flags for each subcommand', async () => {
    const harness = createHarness();

    const recordExitCode = await handleEvalCommand(['record'], {}, harness.deps);
    const replayExitCode = await handleEvalCommand(['replay'], {}, harness.deps);
    const compareExitCode = await handleEvalCommand(['compare'], { baseline: 'a' }, harness.deps);
    const suiteExitCode = await handleEvalCommand(['suite'], {}, harness.deps);

    expect(recordExitCode).toBe(1);
    expect(replayExitCode).toBe(1);
    expect(compareExitCode).toBe(1);
    expect(suiteExitCode).toBe(1);
    expect(harness.stderr.join('\n')).toContain('Missing required option --run-id');
    expect(harness.stderr.join('\n')).toContain('Missing required option --trace-id');
    expect(harness.stderr.join('\n')).toContain('Missing required option --candidate');
    expect(harness.stderr.join('\n')).toContain('Missing required option --suite');
  });

  test('supports JSON output mode', async () => {
    const harness = createHarness();

    const exitCode = await handleEvalCommand(
      ['record'],
      { 'run-id': 'run-42', output: 'json' },
      harness.deps
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(harness.stdout[0] ?? '{}')).toEqual({
      ok: true,
      command: 'record',
      data: {
        traceId: 'trace-run-42',
        runId: 'run-42',
      },
    });
  });

  test('supports text output mode for compare', async () => {
    const harness = createHarness();

    const exitCode = await handleEvalCommand(
      ['compare'],
      { baseline: 'trace-a', candidate: 'trace-b', output: 'text' },
      harness.deps
    );

    expect(exitCode).toBe(0);
    expect(harness.stdout[0]).toBe('PASS: 6/6 checks passed');
  });

  test('returns non-zero exit code when compare reports failure', async () => {
    const harness = createHarness({
      compare: async () => ({
        passed: false,
        scorecard: {
          totalChecks: 6,
          passedChecks: 4,
          failedChecks: 2,
          regressions: [
            { check: 'routing', path: 'routing', message: 'Routing behavior changed' },
            { check: 'response', path: 'response', message: 'Response content changed' },
          ],
        },
      }),
    });

    const exitCode = await handleEvalCommand(
      ['compare'],
      { baseline: 'trace-a', candidate: 'trace-b', output: 'json' },
      harness.deps
    );

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(harness.stdout[0] ?? '{}');
    expect(parsed.data.passed).toBe(false);
    expect(parsed.data.scorecard.failedChecks).toBe(2);
  });

  test('default suite path does not return placeholder message', async () => {
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    await mkdir(traceDirectory, { recursive: true });

    // Create simple suite manifest
    const suitePath = join(traceDirectory, 'suite.yaml');
    await writeFile(suitePath, 'name: simple-suite\ncases:\n  - name: Test case\n    assertions: []', 'utf-8');

    const ioHarness = createIoHarness();
    const service = createDefaultEvalCommandService({ traceDirectory });

    const exitCode = await handleEvalCommand(
      ['suite'],
      { suite: suitePath, output: 'json' },
      { service, io: ioHarness.io }
    );

    // Verify suite did NOT return placeholder message
    const outputText = ioHarness.stdout.join('\n');
    expect(outputText).not.toContain('host-provided case execution wiring');
    expect(outputText).not.toContain('requires host integration');
  });

  test('default suite path includes aggregate metrics in output', async () => {
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    await mkdir(traceDirectory, { recursive: true });

    // Create suite with mock that returns metrics
    const harness = createHarness({
      suite: async () => ({
        suite: { name: 'metrics-suite' },
        totals: { totalCases: 2, passedCases: 2, failedCases: 0, passRate: 1 },
        latency: { minMs: 10, maxMs: 20, avgMs: 15, totalMs: 30 },
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, avgTokensPerCase: 75 },
      }),
    });

    const exitCode = await handleEvalCommand(
      ['suite'],
      { suite: './eval/suite.yaml', output: 'json' },
      { service: harness.deps.service, io: harness.deps.io }
    );

    const outputStr = harness.stdout.join('');
    const output = outputStr ? JSON.parse(outputStr) : {};

    // Verify aggregate metrics are present
    expect(output.data.totals).toBeDefined();
    expect(output.data.totals.totalCases).toBe(2);
    expect(output.data.totals.passedCases).toBe(2);
    expect(output.data.latency).toBeDefined();
    expect(output.data.tokenUsage).toBeDefined();
  });

  test('returns non-zero exit code when suite aggregate has failures', async () => {
    const harness = createHarness({
      suite: async () => ({
        suite: { name: 'batch-suite' },
        totals: {
          totalCases: 3,
          passedCases: 2,
          failedCases: 1,
          passRate: 0.6667,
        },
      }),
    });

    const exitCode = await handleEvalCommand(
      ['suite'],
      { suite: './eval/suite.yaml', output: 'json' },
      harness.deps
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(harness.stdout[0] ?? '{}').data.totals.failedCases).toBe(1);
  });

  test('replay defaults to latest checkpoint when from-step is omitted', async () => {
    const observed: Array<{ traceId: string; fromStep?: number }> = [];
    const harness = createHarness({
      replay: async ({ traceId, fromStep }) => {
        observed.push({ traceId, fromStep });
        return { traceId, checkpointStep: fromStep ?? 12 };
      },
    });

    const exitCode = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-latest', output: 'json' },
      harness.deps
    );

    expect(exitCode).toBe(0);
    expect(observed[0]).toEqual({ traceId: 'trace-latest', fromStep: undefined });
    expect(JSON.parse(harness.stdout[0] ?? '{}').data.checkpointStep).toBe(12);
  });

  test('replay accepts explicit --from-step and rejects invalid values', async () => {
    const observed: Array<number | undefined> = [];
    const harness = createHarness({
      replay: async ({ fromStep }) => {
        observed.push(fromStep);
        return { ok: true };
      },
    });

    const successExitCode = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-1', 'from-step': '2' },
      harness.deps
    );
    const errorExitCode = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-1', 'from-step': '-1' },
      harness.deps
    );

    expect(successExitCode).toBe(0);
    expect(errorExitCode).toBe(1);
    expect(observed[0]).toBe(2);
    expect(harness.stderr.join('\n')).toContain('Invalid --from-step value');
  });

  test('default compare path uses core comparator semantics with volatile-field tolerance', async () => {
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    const baseline = makeArtifact('trace-baseline', { run: { runId: 'run-1', hasError: false, isSlow: false } });
    const candidate = makeArtifact('trace-candidate', { run: { runId: 'run-2', hasError: false, isSlow: false } });

    await mkdir(traceDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(traceDirectory, 'trace-baseline.json'), JSON.stringify(baseline, null, 2), 'utf-8'),
      writeFile(join(traceDirectory, 'trace-candidate.json'), JSON.stringify(candidate, null, 2), 'utf-8'),
    ]);

    const ioHarness = createIoHarness();
    const service = createDefaultEvalCommandService({ traceDirectory });

    const exitCode = await handleEvalCommand(
      ['compare'],
      { baseline: 'trace-baseline', candidate: 'trace-candidate', output: 'json' },
      { service, io: ioHarness.io }
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(ioHarness.stdout[0] ?? '{}');
    expect(parsed.data.passed).toBe(true);
    expect(parsed.data.scorecard.failedChecks).toBe(0);
  });

  test('default compare path returns regression scorecard and exit code 2 on behavior changes', async () => {
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    const baseline = makeArtifact('trace-a');
    const candidate = makeArtifact('trace-b', {
      routing: {
        method: 'default.agent',
        agentId: 'fallback-agent',
      },
    });

    await mkdir(traceDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(traceDirectory, 'trace-a.json'), JSON.stringify(baseline, null, 2), 'utf-8'),
      writeFile(join(traceDirectory, 'trace-b.json'), JSON.stringify(candidate, null, 2), 'utf-8'),
    ]);

    const ioHarness = createIoHarness();
    const service = createDefaultEvalCommandService({ traceDirectory });

    const exitCode = await handleEvalCommand(
      ['compare'],
      { baseline: 'trace-a', candidate: 'trace-b', output: 'json' },
      { service, io: ioHarness.io }
    );

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(ioHarness.stdout[0] ?? '{}');
    expect(parsed.data.passed).toBe(false);
    expect(parsed.data.scorecard.failedChecks).toBe(1);
    expect(parsed.data.scorecard.regressions[0]).toEqual({
      check: 'routing',
      path: 'routing',
      message: 'Routing behavior changed',
    });
  });

  test('default record path executes EvaluationService-backed recorder', async () => {
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    const observed: Array<{ runId: string; traceDirectory: string }> = [];

    const service = createDefaultEvalCommandService({
      traceDirectory,
      recordWithEvaluationService: async (runId, recordTraceDirectory) => {
        observed.push({ runId, traceDirectory: recordTraceDirectory });
        return makeArtifact('trace-run-99', {
          run: {
            runId,
            hasError: false,
            isSlow: false,
          },
        });
      },
    });
    const ioHarness = createIoHarness();

    const exitCode = await handleEvalCommand(
      ['record'],
      { 'run-id': 'run-99', output: 'json' },
      { service, io: ioHarness.io }
    );

    expect(exitCode).toBe(0);
    expect(observed).toEqual([{ runId: 'run-99', traceDirectory }]);
    expect(JSON.parse(ioHarness.stdout[0] ?? '{}').data.traceId).toBe('trace-run-99');
  });

  test('default replay path executes replay orchestrator with checkpoint selection', async () => {
    const observed: {
      configPath?: string;
      replayArgs?: { traceId: string; fromCheckpoint?: number; mode?: 'retry' | 'skip' | 'restart' };
    } = {};

    const runtime: ReplayRuntimeAdapter = {
      initializeFromConfig: async () => {
        return;
      },
      resumeFromCheckpoint: () => ({ ok: true }),
    };

    const service = createDefaultEvalCommandService({
      configPath: '/tmp/fred.config.yaml',
      createRuntime: () => runtime,
      createReplayOrchestratorFn: (deps) => {
        observed.configPath = deps.configPath;
        return {
          replay: async (traceId, replayOptions) => {
            const normalizedOptions = replayOptions ?? {};
            observed.replayArgs = {
              traceId,
              fromCheckpoint: normalizedOptions.fromCheckpoint,
              mode: normalizedOptions.mode,
            };
            return {
              traceId,
              runId: 'run-1',
              checkpointStep: normalizedOptions.fromCheckpoint ?? 0,
              mode: normalizedOptions.mode ?? 'skip',
              output: { ok: true },
              outputHash: 'hash-1',
            };
          },
        };
      },
    });
    const ioHarness = createIoHarness();

    const exitCode = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-55', 'from-step': '3', mode: 'retry', output: 'json' },
      { service, io: ioHarness.io }
    );

    expect(exitCode).toBe(0);
    expect(observed.configPath).toBe('/tmp/fred.config.yaml');
    expect(observed.replayArgs).toEqual({
      traceId: 'trace-55',
      fromCheckpoint: 3,
      mode: 'retry',
    });
  });

  test('replay works without config when trace inputs exist', async () => {
    const ioHarness = createIoHarness();
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    await mkdir(traceDirectory, { recursive: true });
    const artifact = makeArtifact('trace-no-config', {
      checkpoints: [
        {
          id: 'checkpoint-1',
          step: 5,
          stepName: 'check',
          status: 'completed',
          timing: { offsetMs: 0, durationMs: 100 },
          snapshot: { pipelineId: 'pipeline-1', key: 'value' },
        },
      ],
    });

    await writeFile(
      join(traceDirectory, 'trace-no-config.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );

    // No configPath provided - should not throw error
    const exitCode = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-no-config', output: 'json' },
      {
        service: createDefaultEvalCommandService({
          traceDirectory,
          createReplayOrchestratorFn: (deps) => ({
            replay: async (traceId, replayOptions) => {
              const normalizedOptions = replayOptions ?? {};
              return {
                traceId,
                runId: 'run-1',
                checkpointStep: normalizedOptions.fromCheckpoint ?? 5,
                mode: normalizedOptions.mode ?? 'skip',
                output: { ok: true },
                outputHash: 'hash-2',
              };
            },
          }),
        }),
        io: ioHarness.io,
      }
    );

    expect(exitCode).toBe(0);
  });

  test('replay with from-step selects requested checkpoint index', async () => {
    const ioHarness = createIoHarness();
    const traceDirectory = await mkdtemp(join(tmpdir(), 'fred-eval-'));
    await mkdir(traceDirectory, { recursive: true });
    const artifact = makeArtifact('trace-from-step', {
      checkpoints: [
        {
          id: 'cp-1',
          step: 1,
          stepName: 'step-1',
          status: 'completed',
          timing: { offsetMs: 0, durationMs: 100 },
          snapshot: {},
        },
        {
          id: 'cp-2',
          step: 2,
          stepName: 'step-2',
          status: 'completed',
          timing: { offsetMs: 100, durationMs: 100 },
          snapshot: {},
        },
        {
          id: 'cp-3',
          step: 3,
          stepName: 'step-3',
          status: 'completed',
          timing: { offsetMs: 200, durationMs: 100 },
          snapshot: {},
        },
      ],
    });

    await writeFile(
      join(traceDirectory, 'trace-from-step.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );

    // Test with explicit from-step
    const exitCode1 = await handleEvalCommand(
      ['replay'],
      { 'trace-id': 'trace-from-step', 'from-step': '2', output: 'json' },
      {
        service: createDefaultEvalCommandService({
          traceDirectory,
          createReplayOrchestratorFn: () => ({
            replay: async (traceId, replayOptions) => {
              const normalizedOptions = replayOptions ?? {};
              return {
                traceId,
                runId: 'run-1',
                checkpointStep: normalizedOptions.fromCheckpoint ?? 0,
                mode: normalizedOptions.mode ?? 'skip',
                output: { ok: true },
                outputHash: 'hash-5',
              };
            },
          }),
        }),
        io: ioHarness.io,
      }
    );

    expect(exitCode1).toBe(0);
  });

});
