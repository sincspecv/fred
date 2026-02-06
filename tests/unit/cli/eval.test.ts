import { describe, expect, test } from 'bun:test';
import { handleEvalCommand } from '../../../packages/cli/src/eval';

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
});
