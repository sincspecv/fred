import { Schema } from 'effect';
import { load as parseYaml } from 'js-yaml';
import type { EvaluationArtifact } from './artifact';
import { runAssertions, type TestResult } from './assertion-runner';
import { compare, type CompareOptions, type CompareResult } from './comparator';
import type { GoldenTrace } from './golden-trace';

const SuiteCompareConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  ignoreFields: Schema.optional(Schema.Array(Schema.String)),
  ignorePaths: Schema.optional(Schema.Array(Schema.String)),
});

const SuiteReplayConfigSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  fromCheckpoint: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
});

const SuiteCaseSchema = Schema.Struct({
  id: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  input: Schema.optional(Schema.String),
  expectedIntent: Schema.optional(Schema.String),
  assertions: Schema.Array(Schema.Unknown),
  compare: Schema.optional(SuiteCompareConfigSchema),
  replay: Schema.optional(SuiteReplayConfigSchema),
});

const SuiteManifestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  version: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  defaults: Schema.optional(Schema.Struct({
    compare: Schema.optional(SuiteCompareConfigSchema),
    replay: Schema.optional(SuiteReplayConfigSchema),
  })),
  cases: Schema.Array(SuiteCaseSchema).pipe(Schema.minItems(1)),
});

export type SuiteCompareConfig = typeof SuiteCompareConfigSchema.Type;
export type SuiteReplayConfig = typeof SuiteReplayConfigSchema.Type;
export type SuiteCaseDefinition = typeof SuiteCaseSchema.Type;
export type SuiteManifest = typeof SuiteManifestSchema.Type;

export interface SuiteCaseExecutionResult {
  trace?: GoldenTrace;
  candidate?: EvaluationArtifact | GoldenTrace;
  baseline?: EvaluationArtifact | GoldenTrace;
  predictedIntent?: string;
  latencyMs?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}

export interface SuiteCaseReport {
  id: string;
  name: string;
  passed: boolean;
  expectedIntent?: string;
  predictedIntent?: string;
  assertions: TestResult['results'];
  assertionFailures: number;
  compare?: {
    enabled: boolean;
    passed: boolean;
    regressions: number;
    scorecard?: CompareResult['scorecard'];
  };
  latencyMs: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface SuiteReport {
  suite: {
    name: string;
    version?: string;
  };
  totals: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    passRate: number;
  };
  latency: {
    minMs: number;
    maxMs: number;
    avgMs: number;
    totalMs: number;
  };
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerCase: number;
  };
  regressions: {
    comparedCases: number;
    passedCases: number;
    failedCases: number;
    totalRegressions: number;
  };
  cases: SuiteCaseReport[];
}

export function decodeSuiteManifest(input: unknown): SuiteManifest {
  return Schema.decodeUnknownSync(SuiteManifestSchema, { errors: 'all' })(input);
}

export function parseSuiteManifest(input: string | unknown): SuiteManifest {
  if (typeof input !== 'string') {
    return decodeSuiteManifest(input);
  }

  try {
    return decodeSuiteManifest(JSON.parse(input));
  } catch {
    const parsed = parseYaml(input);
    return decodeSuiteManifest(parsed);
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function computeLatencyMs(trace?: GoldenTrace, provided?: number): number {
  if (typeof provided === 'number' && Number.isFinite(provided) && provided >= 0) {
    return provided;
  }

  const spans = trace?.trace.spans ?? [];
  if (spans.length === 0) {
    return 0;
  }

  const starts = spans.map((span) => span.startTime);
  const ends = spans.map((span) => span.endTime);
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

function normalizeTokenUsage(tokenUsage: SuiteCaseExecutionResult['tokenUsage']): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const inputTokens = Math.max(0, tokenUsage?.inputTokens ?? 0);
  const outputTokens = Math.max(0, tokenUsage?.outputTokens ?? 0);
  const totalTokens = Math.max(0, tokenUsage?.totalTokens ?? inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

function resolveCompareConfig(
  suiteDefaults: SuiteManifest['defaults'] | undefined,
  testCase: SuiteCaseDefinition
): SuiteCompareConfig | undefined {
  return {
    ...(suiteDefaults?.compare ?? {}),
    ...(testCase.compare ?? {}),
  };
}

function buildCompareOptions(compareConfig: SuiteCompareConfig | undefined): CompareOptions {
  return {
    ignoreFields: compareConfig?.ignoreFields ? [...compareConfig.ignoreFields] : undefined,
    ignorePaths: compareConfig?.ignorePaths ? [...compareConfig.ignorePaths] : undefined,
  };
}

export async function runSuite(
  manifestInput: SuiteManifest | string | unknown,
  executeCase: (testCase: SuiteCaseDefinition, index: number) => Promise<SuiteCaseExecutionResult>
): Promise<SuiteReport> {
  const manifest = typeof manifestInput === 'string'
    ? parseSuiteManifest(manifestInput)
    : decodeSuiteManifest(manifestInput);

  const reports: SuiteCaseReport[] = [];

  for (const [index, testCase] of manifest.cases.entries()) {
    const id = testCase.id ?? `${index + 1}`;

    try {
      const execution = await executeCase(testCase, index);
      const assertionResults = execution.trace && testCase.assertions.length > 0
        ? await runAssertions(execution.trace, [...testCase.assertions])
        : [];

      const assertionFailures = assertionResults.filter((result) => !result.passed).length;
      const assertionsPassed = assertionFailures === 0;

      const compareConfig = resolveCompareConfig(manifest.defaults, testCase);
      const compareEnabled = Boolean(compareConfig?.enabled);
      const compareResult = compareEnabled && execution.baseline && execution.candidate
        ? compare(execution.baseline, execution.candidate, buildCompareOptions(compareConfig))
        : undefined;

      const expectedIntent = testCase.expectedIntent;
      const predictedIntent = execution.predictedIntent ?? execution.trace?.trace.routing.intentId;
      const intentPassed = expectedIntent === undefined || expectedIntent === predictedIntent;

      const comparePassed = compareEnabled ? compareResult?.passed ?? false : true;
      const passed = !execution.error && assertionsPassed && comparePassed && intentPassed;

      reports.push({
        id,
        name: testCase.name,
        passed,
        expectedIntent,
        predictedIntent,
        assertions: assertionResults,
        assertionFailures,
        compare: compareEnabled
          ? {
              enabled: true,
              passed: comparePassed,
              regressions: compareResult?.scorecard.failedChecks ?? 0,
              scorecard: compareResult?.scorecard,
            }
          : undefined,
        latencyMs: computeLatencyMs(execution.trace, execution.latencyMs),
        tokenUsage: normalizeTokenUsage(execution.tokenUsage),
        error: execution.error,
      });
    } catch (error) {
      reports.push({
        id,
        name: testCase.name,
        passed: false,
        expectedIntent: testCase.expectedIntent,
        assertions: [],
        assertionFailures: 0,
        latencyMs: 0,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalCases = reports.length;
  const passedCases = reports.filter((report) => report.passed).length;
  const failedCases = totalCases - passedCases;

  const totalLatency = reports.reduce((sum, report) => sum + report.latencyMs, 0);
  const totalInputTokens = reports.reduce((sum, report) => sum + report.tokenUsage.inputTokens, 0);
  const totalOutputTokens = reports.reduce((sum, report) => sum + report.tokenUsage.outputTokens, 0);
  const totalTokens = reports.reduce((sum, report) => sum + report.tokenUsage.totalTokens, 0);

  const compared = reports.filter((report) => report.compare?.enabled);
  const comparePassed = compared.filter((report) => report.compare?.passed).length;
  const compareFailed = compared.length - comparePassed;
  const totalRegressions = compared.reduce((sum, report) => sum + (report.compare?.regressions ?? 0), 0);

  return {
    suite: {
      name: manifest.name,
      version: manifest.version,
    },
    totals: {
      totalCases,
      passedCases,
      failedCases,
      passRate: totalCases === 0 ? 0 : round(passedCases / totalCases),
    },
    latency: {
      minMs: totalCases === 0 ? 0 : Math.min(...reports.map((report) => report.latencyMs)),
      maxMs: totalCases === 0 ? 0 : Math.max(...reports.map((report) => report.latencyMs)),
      avgMs: totalCases === 0 ? 0 : round(totalLatency / totalCases),
      totalMs: totalLatency,
    },
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      avgTokensPerCase: totalCases === 0 ? 0 : round(totalTokens / totalCases),
    },
    regressions: {
      comparedCases: compared.length,
      passedCases: comparePassed,
      failedCases: compareFailed,
      totalRegressions,
    },
    cases: reports,
  };
}
