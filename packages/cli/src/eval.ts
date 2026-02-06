import { readFile } from 'fs/promises';
import { isDeepStrictEqual } from 'util';
import { type EvaluationArtifact, validateEvaluationArtifact } from '@fancyrobot/fred';

export type EvalOutputFormat = 'text' | 'json';

export interface EvalCompareInput {
  baselineTraceId: string;
  candidateTraceId: string;
}

export interface EvalRecordInput {
  runId: string;
}

export interface EvalReplayInput {
  traceId: string;
  fromStep?: number;
  mode?: 'retry' | 'skip' | 'restart';
}

export interface EvalSuiteInput {
  suitePath: string;
}

export interface EvalResultEnvelope<T> {
  ok: boolean;
  command: string;
  data?: T;
  error?: string;
}

export interface EvalCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface EvalCommandService {
  record: (input: EvalRecordInput) => Promise<unknown>;
  replay: (input: EvalReplayInput) => Promise<unknown>;
  compare: (input: EvalCompareInput) => Promise<EvalCompareResult>;
  suite: (input: EvalSuiteInput) => Promise<unknown>;
}

export interface EvalCommandDependencies {
  service: EvalCommandService;
  io?: EvalCommandIO;
}

const DEFAULT_TRACE_DIR = '.fred/eval/traces';

export interface EvalCompareResult {
  passed: boolean;
  scorecard: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    regressions: Array<{ check: string; path: string; message: string }>;
  };
}

function getOption(options: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = options[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function parseOutputFormat(options: Record<string, unknown>): EvalOutputFormat {
  const raw = getOption(options, 'output');
  if (raw === undefined) {
    return 'text';
  }

  if (raw !== 'text' && raw !== 'json') {
    throw new Error('Invalid --output value. Expected "text" or "json".');
  }

  return raw;
}

function requireStringOption(options: Record<string, unknown>, flag: string, ...aliases: string[]): string {
  const value = getOption(options, flag, ...aliases);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required option --${flag}.`);
  }
  return value;
}

function parseOptionalStep(options: Record<string, unknown>): number | undefined {
  const value = getOption(options, 'from-step', 'fromStep');
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Invalid --from-step value. Expected a non-negative integer.');
  }
  return parsed;
}

function parseOptionalMode(options: Record<string, unknown>): 'retry' | 'skip' | 'restart' | undefined {
  const value = getOption(options, 'mode');
  if (value === undefined) {
    return undefined;
  }

  if (value === 'retry' || value === 'skip' || value === 'restart') {
    return value;
  }

  throw new Error('Invalid --mode value. Expected "retry", "skip", or "restart".');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeEnvelope<T>(
  io: EvalCommandIO,
  output: EvalOutputFormat,
  command: string,
  result: EvalResultEnvelope<T>
): void {
  if (output === 'json') {
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    io.stderr(`${command}: ${result.error ?? 'unknown error'}`);
    return;
  }

  io.stdout(String(result.data ?? 'ok'));
}

function summarizeCompare(result: EvalCompareResult): string {
  const status = result.passed ? 'PASS' : 'FAIL';
  return `${status}: ${result.scorecard.passedChecks}/${result.scorecard.totalChecks} checks passed`;
}

function inferSuiteFailure(suiteReport: unknown): boolean {
  if (!suiteReport || typeof suiteReport !== 'object') {
    return false;
  }

  const maybePassed = (suiteReport as { passed?: unknown }).passed;
  if (typeof maybePassed === 'boolean') {
    return !maybePassed;
  }

  const maybeTotals = (suiteReport as { totals?: { failedCases?: unknown } }).totals;
  if (maybeTotals && typeof maybeTotals.failedCases === 'number') {
    return maybeTotals.failedCases > 0;
  }

  return false;
}

async function loadArtifact(traceId: string, directory = DEFAULT_TRACE_DIR): Promise<EvaluationArtifact> {
  const content = await readFile(`${directory}/${traceId}.json`, 'utf-8');
  const parsed: unknown = JSON.parse(content);

  if (!validateEvaluationArtifact(parsed)) {
    throw new Error(`Trace "${traceId}" is not a valid evaluation artifact.`);
  }

  return parsed;
}

export function createDefaultEvalCommandService(): EvalCommandService {
  return {
    record: async ({ runId }) => {
      return {
        runId,
        message: 'Record execution requires a runtime-integrated EvaluationService adapter.',
      };
    },
    replay: async ({ traceId, fromStep, mode }) => {
      return {
        traceId,
        fromStep,
        mode: mode ?? 'skip',
        message: 'Replay execution requires a runtime adapter configured by the host project.',
      };
    },
    compare: async ({ baselineTraceId, candidateTraceId }) => {
      const [baseline, candidate] = await Promise.all([
        loadArtifact(baselineTraceId),
        loadArtifact(candidateTraceId),
      ]);

      const passed = isDeepStrictEqual(baseline, candidate);
      return {
        passed,
        scorecard: {
          totalChecks: 1,
          passedChecks: passed ? 1 : 0,
          failedChecks: passed ? 0 : 1,
          regressions: passed
            ? []
            : [
                {
                  check: 'artifact',
                  path: 'root',
                  message: 'Evaluation artifacts differ',
                },
              ],
        },
      };
    },
    suite: async ({ suitePath }) => {
      return {
        suitePath,
        message: 'Suite execution requires host-provided case execution wiring.',
      };
    },
  };
}

export async function handleEvalCommand(
  args: string[],
  options: Record<string, unknown>,
  dependencies: EvalCommandDependencies = { service: createDefaultEvalCommandService() }
): Promise<number> {
  const io: EvalCommandIO = dependencies.io ?? {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  };

  const subcommand = args[0];

  if (!subcommand) {
    io.stderr('Missing eval subcommand. Use one of: record, replay, compare, suite.');
    return 1;
  }

  let output: EvalOutputFormat = 'text';
  try {
    output = parseOutputFormat(options);
  } catch (error) {
    writeEnvelope(io, 'text', subcommand, {
      ok: false,
      command: subcommand,
      error: toErrorMessage(error),
    });
    return 1;
  }

  try {
    switch (subcommand) {
      case 'record': {
        const runId = requireStringOption(options, 'run-id', 'runId');
        const result = await dependencies.service.record({ runId });
        writeEnvelope(io, output, 'record', {
          ok: true,
          command: 'record',
          data: result,
        });
        return 0;
      }

      case 'replay': {
        const traceId = requireStringOption(options, 'trace-id', 'traceId');
        const fromStep = parseOptionalStep(options);
        const mode = parseOptionalMode(options);
        const result = await dependencies.service.replay({ traceId, fromStep, mode });
        writeEnvelope(io, output, 'replay', {
          ok: true,
          command: 'replay',
          data: result,
        });
        return 0;
      }

      case 'compare': {
        const baselineTraceId = requireStringOption(options, 'baseline');
        const candidateTraceId = requireStringOption(options, 'candidate');
        const result = await dependencies.service.compare({ baselineTraceId, candidateTraceId });

        if (output === 'text') {
          io.stdout(summarizeCompare(result));
        } else {
          io.stdout(
            JSON.stringify(
              {
                ok: true,
                command: 'compare',
                data: result,
              },
              null,
              2
            )
          );
        }

        return result.passed ? 0 : 2;
      }

      case 'suite': {
        const suitePath = requireStringOption(options, 'suite', 'suite-file', 'suiteFile');
        const result = await dependencies.service.suite({ suitePath });
        writeEnvelope(io, output, 'suite', {
          ok: true,
          command: 'suite',
          data: result,
        });
        return inferSuiteFailure(result) ? 2 : 0;
      }

      default:
        io.stderr(`Unknown eval subcommand: ${subcommand}. Use one of: record, replay, compare, suite.`);
        return 1;
    }
  } catch (error) {
    const message = toErrorMessage(error);
    if (output === 'json') {
      io.stdout(
        JSON.stringify(
          {
            ok: false,
            command: subcommand,
            error: message,
          },
          null,
          2
        )
      );
    } else {
      io.stderr(`${subcommand}: ${message}`);
    }
    return 1;
  }
}
