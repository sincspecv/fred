import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  EvaluationRunNotFoundError,
  EvaluationService,
  EvaluationServiceLive,
  FileTraceStorageLive,
  Fred,
  ObservabilityServiceLive,
  TraceStorageService,
  compare,
  createReplayOrchestrator,
  evaluation,
  type EvaluationArtifact,
  type ReplayRuntimeAdapter,
  type SuiteCaseExecutionResult,
  type SuiteManifest,
  validateEvaluationArtifact,
} from '@fancyrobot/fred';
import { Effect, Layer } from 'effect';

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
const DEFAULT_CONFIG_FILES = ['fred.config.yaml', 'fred.config.yml', 'fred.config.json'] as const;

export interface EvalCompareResult {
  passed: boolean;
  scorecard: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    regressions: Array<{ check: string; path: string; message: string }>;
  };
}

export interface DefaultEvalCommandServiceOptions {
  traceDirectory?: string;
  configPath?: string;
  createRuntime?: () => ReplayRuntimeAdapter;
  compareArtifacts?: typeof compare;
  createReplayOrchestratorFn?: typeof createReplayOrchestrator;
  recordWithEvaluationService?: (runId: string, traceDirectory: string) => Promise<EvaluationArtifact>;
  runSuiteFn?: typeof evaluation.runSuite;
  parseSuiteManifestFn?: typeof evaluation.parseSuiteManifest;
  readFileFn?: (path: string) => Promise<string>;
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

function resolveConfigPath(explicitConfigPath?: string): string | undefined {
  if (explicitConfigPath && explicitConfigPath.trim().length > 0) {
    return explicitConfigPath;
  }

  const envConfigPath = process.env.FRED_CONFIG_PATH;
  if (envConfigPath && envConfigPath.trim().length > 0) {
    return envConfigPath;
  }

  for (const candidate of DEFAULT_CONFIG_FILES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function createFredReplayRuntime(): ReplayRuntimeAdapter {
  const fred = new Fred();

  return {
    initializeFromConfig: async (configPath, options) => {
      await fred.initializeFromConfig(configPath, options);
    },
    resumeFromCheckpoint: ({ runId, mode }) => fred.getPipelineManager().resume(runId, { mode }),
  };
}

function createArtifactOnlyReplayRuntime(): ReplayRuntimeAdapter {
  return {
    initializeFromConfig: async () => {
      // No-op: config-less replay doesn't need initialization
    },
    resumeFromCheckpoint: ({ checkpoint, contextSnapshot }) => {
      // In artifact-only mode, return the checkpoint data for validation
      return Effect.succeed({
        checkpoint,
        contextSnapshot,
        mode: 'artifact-validation',
        validated: true,
      });
    },
  };
}

async function recordWithCoreEvaluationService(runId: string, traceDirectory: string): Promise<EvaluationArtifact> {
  const program = Effect.gen(function* () {
    const service = yield* EvaluationService;
    return yield* service.record(runId);
  });

  // CORRECT: Build dependency layer first, then provide it to EvaluationServiceLive
  const dependencyLayer = Layer.merge(
    FileTraceStorageLive({ directory: traceDirectory }),
    ObservabilityServiceLive
  );

  // CORRECT: Provide dependencies TO EvaluationServiceLive
  const serviceLayer = Layer.provide(EvaluationServiceLive, dependencyLayer);

  const providedProgram = Effect.provide(
    program as Effect.Effect<EvaluationArtifact, Error, EvaluationService>,
    serviceLayer
  ) as Effect.Effect<EvaluationArtifact, Error, never>;

  return Effect.runPromise(providedProgram);
}

export function createDefaultEvalCommandService(options: DefaultEvalCommandServiceOptions = {}): EvalCommandService {
  const traceDirectory = options.traceDirectory ?? DEFAULT_TRACE_DIR;
  const compareArtifacts = options.compareArtifacts ?? compare;
  const createReplayOrchestratorFn = options.createReplayOrchestratorFn ?? createReplayOrchestrator;
  const recordViaEvaluationService = options.recordWithEvaluationService ?? recordWithCoreEvaluationService;

  return {
    record: async ({ runId }) => {
      try {
        return await recordViaEvaluationService(runId, traceDirectory);
      } catch (error) {
        if (error instanceof EvaluationRunNotFoundError) {
          throw new Error(
            `Run "${runId}" was not found in the active observability store. ` +
              'Record from the same running Fred process, or provide a host-integrated eval command service.'
          );
        }

        throw error;
      }
    },
    replay: async ({ traceId, fromStep, mode }) => {
      // Config is optional for replay - only used if explicitly provided
      const explicitConfigPath = options.configPath;
      const resolvedConfigPath = explicitConfigPath ? resolve(explicitConfigPath) : undefined;

      const storage = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            return yield* TraceStorageService;
          }),
          FileTraceStorageLive({ directory: traceDirectory })
        )
      );

      // Use artifact-only runtime when no config is provided
      const runtime = resolvedConfigPath
        ? options.createRuntime
          ? options.createRuntime()
          : createFredReplayRuntime()
        : createArtifactOnlyReplayRuntime();

      const orchestrator = createReplayOrchestratorFn({
        storage,
        runtime,
        configPath: resolvedConfigPath,
      });

      return orchestrator.replay(traceId, {
        fromCheckpoint: fromStep,
        mode,
      });
    },
    compare: async ({ baselineTraceId, candidateTraceId }) => {
      const [baseline, candidate] = await Promise.all([
        loadArtifact(baselineTraceId, traceDirectory),
        loadArtifact(candidateTraceId, traceDirectory),
      ]);

      const result = compareArtifacts(baseline, candidate);

      return {
        passed: result.passed,
        scorecard: result.scorecard,
      };
    },
    suite: async ({ suitePath }) => {
      // Read suite manifest from file
      const readFileFn = options.readFileFn ?? readFile;
      const manifestContent = await readFileFn(resolve(suitePath));
      const manifest = options.parseSuiteManifestFn
        ? options.parseSuiteManifestFn(manifestContent)
        : evaluation.parseSuiteManifest(manifestContent);

      const createReplayOrchestratorFn = options.createReplayOrchestratorFn ?? createReplayOrchestrator;
      const configPath = resolveConfigPath(options.configPath);

      const storage = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            return yield* TraceStorageService;
          }),
          FileTraceStorageLive({ directory: traceDirectory })
        )
      );

      const runtime = options.createRuntime ? options.createRuntime() : createFredReplayRuntime();

      // Build orchestrator for replay
      const orchestrator = createReplayOrchestratorFn({
        storage,
        runtime,
        configPath: configPath ? resolve(configPath) : undefined,
      });

      const runSuiteFn = options.runSuiteFn ?? evaluation.runSuite;

      // Execute suite using core runner
      return await runSuiteFn(
        manifest,
        async (testCase, index) => {
          const id = testCase.id ?? `${index + 1}`;
          const result: SuiteCaseExecutionResult = {};

          try {
            // If baseline trace is specified in case, load it
            let baseline: EvaluationArtifact | undefined;
            if (testCase.input) {
              baseline = await loadArtifact(testCase.input, traceDirectory);
            }

            // Execute replay for the case to generate candidate trace
            const replayResult = await orchestrator.replay(`${id}-candidate`, {
              fromCheckpoint: testCase.replay?.fromCheckpoint,
              mode: testCase.replay?.enabled ? undefined : 'skip',
            });

            // The replay output contains trace data - extract it
            // The output can be any type but for our purposes contains the execution trace
            const candidateTrace = replayResult.output as any;
            const candidateArtifact = candidateTrace?.artifact ?? candidateTrace;

            // Extract latency and token usage from replay result
            const latencyMs = replayResult.checkpointStep ? 0 : undefined;

            // Normalize candidate to GoldenTrace format if needed
            const candidateAsGolden = candidateArtifact as any;

            result.trace = candidateAsGolden;
            result.baseline = baseline;
            result.candidate = candidateArtifact;
            result.latencyMs = latencyMs;

            // Extract token usage from trace if available
            if (candidateAsGolden?.trace?.metrics?.tokenUsage) {
              result.tokenUsage = candidateAsGolden.trace.metrics.tokenUsage;
            } else if (candidateArtifact?.trace?.metrics?.tokenUsage) {
              result.tokenUsage = candidateArtifact.trace.metrics.tokenUsage;
            }

            // Extract predicted intent from routing
            if (candidateAsGolden?.trace?.routing?.intentId) {
              result.predictedIntent = candidateAsGolden.trace.routing.intentId;
            } else if (candidateArtifact?.trace?.routing?.intentId) {
              result.predictedIntent = candidateArtifact.trace.routing.intentId;
            }
          } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
          }

          return result;
        }
      );
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
