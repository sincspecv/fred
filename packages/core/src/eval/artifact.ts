import { createHash } from 'crypto';

export const EVAL_ARTIFACT_VERSION = '1.0';

export interface EvalEnvironmentMetadata {
  environment: string;
  fredVersion: string;
  gitCommit?: string;
  nodeVersion?: string;
  platform?: string;
}

export interface EvalTiming {
  offsetMs: number;
  durationMs: number;
}

export interface EvalRoutingArtifact {
  method: 'agent.utterance' | 'intent.matching' | 'default.agent' | 'unknown';
  agentId?: string;
  intentId?: string;
  confidence?: number;
  matchType?: 'exact' | 'regex' | 'semantic';
}

export interface EvalResponseArtifact {
  content: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

export interface EvalStepArtifact {
  id: string;
  index: number;
  name: string;
  status: 'success' | 'error';
  timing: EvalTiming;
  metadata: Record<string, unknown>;
}

export interface EvalToolCallArtifact {
  id: string;
  toolId: string;
  stepIndex: number;
  callOrdinal: number;
  timing: EvalTiming;
  status: 'success' | 'error';
  error?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  inputHash?: string;
  outputHash?: string;
}

export interface EvalCheckpointArtifact {
  id: string;
  step: number;
  stepName?: string;
  status: string;
  timing: EvalTiming;
  snapshot: Record<string, unknown>;
}

export interface EvalHandoffArtifact {
  id: string;
  fromAgent?: string;
  toAgent: string;
  message: string;
  depth: number;
  timing: EvalTiming;
}

export interface EvaluationArtifact {
  version: string;
  traceId: string;
  run: {
    runId: string;
    sourceTraceId?: string;
    hasError: boolean;
    isSlow: boolean;
  };
  environment: EvalEnvironmentMetadata;
  input: {
    message: string;
  };
  routing: EvalRoutingArtifact;
  response: EvalResponseArtifact;
  steps: EvalStepArtifact[];
  toolCalls: EvalToolCallArtifact[];
  checkpoints: EvalCheckpointArtifact[];
  handoffs: EvalHandoffArtifact[];
}

export interface EvaluationArtifactSummary {
  traceId: string;
  runId: string;
  version: string;
  environment: string;
}

export function stableTupleId(parts: ReadonlyArray<string | number>): string {
  return parts.map((part) => String(part)).join(':');
}

export function deriveTraceId(runId: string, seed: unknown): string {
  const payload = JSON.stringify(toDeterministicValue(seed));
  const digest = createHash('sha256').update(`${runId}:${payload}`).digest('hex').substring(0, 16);
  return `trace-${digest}`;
}

export function toDeterministicValue<T>(value: T): T {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }

    if (input !== null && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const next = normalize((input as Record<string, unknown>)[key]);
        if (next !== undefined) {
          result[key] = next;
        }
      }
      return result;
    }

    return input;
  };

  return normalize(value) as T;
}

export function stringifyEvaluationArtifact(artifact: EvaluationArtifact): string {
  return JSON.stringify(toDeterministicValue(artifact), null, 2);
}

export function validateEvaluationArtifact(artifact: unknown): artifact is EvaluationArtifact {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }

  const value = artifact as Partial<EvaluationArtifact>;
  return (
    typeof value.version === 'string' &&
    typeof value.traceId === 'string' &&
    typeof value.run?.runId === 'string' &&
    typeof value.environment?.environment === 'string' &&
    typeof value.environment?.fredVersion === 'string' &&
    typeof value.input?.message === 'string' &&
    typeof value.response?.content === 'string' &&
    Array.isArray(value.steps) &&
    Array.isArray(value.toolCalls) &&
    Array.isArray(value.checkpoints) &&
    Array.isArray(value.handoffs)
  );
}
