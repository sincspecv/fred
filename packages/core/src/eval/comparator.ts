import deepEqual from 'fast-deep-equal';
import * as jsondiffpatch from 'jsondiffpatch';
import { toDeterministicValue, validateEvaluationArtifact, type EvalEnvironmentMetadata, type EvaluationArtifact } from './artifact';
import { normalizeLegacyGoldenTrace } from './normalizer';
import { validateGoldenTrace, type GoldenTrace } from './golden-trace';

const DEFAULT_VOLATILE_FIELDS = [
  'timestamp',
  'startTime',
  'endTime',
  'traceId',
  'spanId',
  'parentSpanId',
  'runId',
  'sourceTraceId',
];

const CHECKS: Array<{ id: string; path: string; label: string }> = [
  { id: 'routing', path: 'routing', label: 'Routing behavior changed' },
  { id: 'response', path: 'response', label: 'Response content changed' },
  { id: 'toolCalls', path: 'toolCalls', label: 'Tool usage changed' },
  { id: 'steps', path: 'steps', label: 'Execution steps changed' },
  { id: 'checkpoints', path: 'checkpoints', label: 'Checkpoint artifacts changed' },
  { id: 'handoffs', path: 'handoffs', label: 'Handoff behavior changed' },
];

export interface CompareOptions {
  ignoreFields?: string[];
  ignorePaths?: string[];
  environment?: EvalEnvironmentMetadata;
}

export interface CompareRegression {
  check: string;
  path: string;
  message: string;
}

export interface CompareScorecard {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  regressions: CompareRegression[];
}

export interface CompareResult {
  passed: boolean;
  scorecard: CompareScorecard;
  details: {
    equal: boolean;
    delta?: unknown;
    baseline: EvaluationArtifact;
    candidate: EvaluationArtifact;
  };
}

function toSet(values?: ReadonlyArray<string>): Set<string> {
  return new Set((values ?? []).filter((value) => value.length > 0));
}

function stripIgnored(
  value: unknown,
  ignoredFields: ReadonlySet<string>,
  ignoredPaths: ReadonlySet<string>,
  path: string[] = []
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => stripIgnored(item, ignoredFields, ignoredPaths, [...path, String(index)]));
  }

  if (value !== null && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const currentPath = [...path, key].join('.');
      if (ignoredFields.has(key) || ignoredPaths.has(currentPath)) {
        continue;
      }
      next[key] = stripIgnored(child, ignoredFields, ignoredPaths, [...path, key]);
    }
    return next;
  }

  return value;
}

function getPathValue(value: unknown, path: string): unknown {
  if (!path) return value;
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (current !== null && typeof current === 'object') {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, value);
}

function normalizeInput(input: EvaluationArtifact | GoldenTrace, options: CompareOptions): EvaluationArtifact {
  if (validateEvaluationArtifact(input)) {
    return toDeterministicValue(input);
  }

  if (validateGoldenTrace(input)) {
    return normalizeLegacyGoldenTrace({
      trace: input,
      environment: options.environment ?? {
        environment: 'unknown',
        fredVersion: 'unknown',
      },
    });
  }

  throw new Error('compare() expects EvaluationArtifact or GoldenTrace input');
}

export function compare(
  baselineInput: EvaluationArtifact | GoldenTrace,
  candidateInput: EvaluationArtifact | GoldenTrace,
  options: CompareOptions = {}
): CompareResult {
  const baselineNormalized = normalizeInput(baselineInput, options);
  const candidateNormalized = normalizeInput(candidateInput, options);

  const ignoredFields = new Set([...DEFAULT_VOLATILE_FIELDS, ...(options.ignoreFields ?? [])]);
  const ignoredPaths = toSet(options.ignorePaths);

  const baseline = toDeterministicValue(
    stripIgnored(baselineNormalized, ignoredFields, ignoredPaths) as EvaluationArtifact
  );
  const candidate = toDeterministicValue(
    stripIgnored(candidateNormalized, ignoredFields, ignoredPaths) as EvaluationArtifact
  );

  const equal = deepEqual(baseline, candidate);
  const regressions: CompareRegression[] = [];

  for (const check of CHECKS) {
    const checkEqual = deepEqual(getPathValue(baseline, check.path), getPathValue(candidate, check.path));
    if (!checkEqual) {
      regressions.push({
        check: check.id,
        path: check.path,
        message: check.label,
      });
    }
  }

  const scorecard: CompareScorecard = {
    totalChecks: CHECKS.length,
    passedChecks: CHECKS.length - regressions.length,
    failedChecks: regressions.length,
    regressions,
  };

  let delta: unknown = undefined;
  if (!equal) {
    const diffpatcher = jsondiffpatch.create({
      propertyFilter: (name: string) => !ignoredFields.has(name),
    });
    delta = diffpatcher.diff(baseline, candidate);
  }

  return {
    passed: scorecard.failedChecks === 0,
    scorecard,
    details: {
      equal,
      delta,
      baseline,
      candidate,
    },
  };
}
