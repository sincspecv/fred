import type { RunRecord } from '../observability/service';
import type { Checkpoint } from '../pipeline/checkpoint/types';
import type { AgentResponse } from '../agent/agent';
import type { GoldenTrace } from './golden-trace';
import {
  EVAL_ARTIFACT_VERSION,
  type EvalCheckpointArtifact,
  type EvalEnvironmentMetadata,
  type EvalHandoffArtifact,
  type EvalRoutingArtifact,
  type EvalStepArtifact,
  type EvalToolCallArtifact,
  type EvaluationArtifact,
  deriveTraceId,
  stableTupleId,
  toDeterministicValue,
} from './artifact';

const VOLATILE_KEYS = new Set([
  'timestamp',
  'startTime',
  'endTime',
  'traceId',
  'spanId',
  'parentSpanId',
]);

export interface NormalizationCheckpoint {
  step: number;
  stepName?: string;
  status: string;
  createdAt: number | string | Date;
  snapshot: Record<string, unknown>;
}

export interface NormalizeRunRecordInput {
  runRecord: RunRecord;
  environment: EvalEnvironmentMetadata;
  message?: string;
  response?: AgentResponse | { content: string; role?: string; metadata?: Record<string, unknown> };
  routing?: EvalRoutingArtifact;
  checkpoints?: NormalizationCheckpoint[];
}

function getResponseRole(
  response: AgentResponse | { content: string; role?: string; metadata?: Record<string, unknown> }
): string | undefined {
  return 'role' in response ? response.role : undefined;
}

function getResponseMetadata(
  response: AgentResponse | { content: string; role?: string; metadata?: Record<string, unknown> }
): Record<string, unknown> {
  if ('metadata' in response && response.metadata) {
    return response.metadata;
  }
  return {};
}

export interface NormalizeLegacyTraceInput {
  trace: GoldenTrace;
  environment: EvalEnvironmentMetadata;
  runId?: string;
  checkpoints?: NormalizationCheckpoint[];
}

function toMs(input: number | string | Date | undefined): number {
  if (input === undefined) return 0;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : 0;
  }
  const parsed = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeVolatile(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeVolatile(item));
  }

  if (input !== null && typeof input === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) {
        continue;
      }
      next[key] = sanitizeVolatile(value);
    }
    return next;
  }

  return input;
}

function collectOrigin(...timeSets: ReadonlyArray<number[]>): number {
  const flat = timeSets.flat().filter((value) => Number.isFinite(value) && value > 0);
  if (flat.length === 0) {
    return 0;
  }
  return Math.min(...flat);
}

function toTiming(originMs: number, startMs: number, durationMs: number): { offsetMs: number; durationMs: number } {
  return {
    offsetMs: Math.max(0, startMs - originMs),
    durationMs: Math.max(0, durationMs),
  };
}

function normalizeCheckpoints(
  checkpoints: ReadonlyArray<NormalizationCheckpoint>,
  originMs: number
): EvalCheckpointArtifact[] {
  return checkpoints
    .map((checkpoint) => {
      const createdAt = toMs(checkpoint.createdAt);
      return {
        id: stableTupleId(['checkpoint', checkpoint.step, checkpoint.status]),
        step: checkpoint.step,
        stepName: checkpoint.stepName,
        status: checkpoint.status,
        timing: toTiming(originMs, createdAt, 0),
        snapshot: toDeterministicValue(sanitizeVolatile(checkpoint.snapshot) as Record<string, unknown>),
      };
    })
    .sort((a, b) => (a.step === b.step ? a.status.localeCompare(b.status) : a.step - b.step));
}

function normalizeCheckpointsFromStorage(
  checkpoints: ReadonlyArray<Checkpoint>,
  originMs: number
): EvalCheckpointArtifact[] {
  return normalizeCheckpoints(
    checkpoints.map((checkpoint) => ({
      step: checkpoint.step,
      stepName: checkpoint.stepName,
      status: checkpoint.status,
      createdAt: checkpoint.createdAt,
      snapshot: {
        pipelineId: checkpoint.pipelineId,
        context: checkpoint.context as unknown as Record<string, unknown>,
        pauseMetadata: checkpoint.pauseMetadata,
      },
    })),
    originMs
  );
}

export function normalizeRunRecord(input: NormalizeRunRecordInput): EvaluationArtifact {
  const run = input.runRecord;

  const originMs = collectOrigin(
    [run.startTime, run.endTime ?? 0],
    run.stepSpans.flatMap((step) => [step.startTime, step.endTime]),
    run.toolUsage.map((tool) => tool.timestamp),
    input.checkpoints?.map((checkpoint) => toMs(checkpoint.createdAt)) ?? []
  );

  const sortedSteps = [...run.stepSpans].sort((a, b) => {
    if (a.startTime === b.startTime) {
      return a.stepName.localeCompare(b.stepName);
    }
    return a.startTime - b.startTime;
  });

  const steps: EvalStepArtifact[] = sortedSteps.map((step, index) => ({
    id: stableTupleId(['step', index, step.stepName]),
    index,
    name: step.stepName,
    status: step.status,
    timing: toTiming(originMs, step.startTime, step.endTime - step.startTime),
    metadata: toDeterministicValue(sanitizeVolatile(step.metadata) as Record<string, unknown>),
  }));

  const stepByTime = sortedSteps.map((step, index) => ({
    index,
    startTime: step.startTime,
    endTime: step.endTime,
  }));

  const toolCallOrdinals = new Map<string, number>();
  const toolCalls: EvalToolCallArtifact[] = [...run.toolUsage]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((usage) => {
      const step = stepByTime.find((candidate) => usage.timestamp >= candidate.startTime && usage.timestamp <= candidate.endTime);
      const stepIndex = step?.index ?? -1;
      const key = `${stepIndex}:${usage.toolId}`;
      const ordinal = toolCallOrdinals.get(key) ?? 0;
      toolCallOrdinals.set(key, ordinal + 1);

      return {
        id: stableTupleId([stepIndex, usage.toolId, ordinal]),
        toolId: usage.toolId,
        stepIndex,
        callOrdinal: ordinal,
        timing: toTiming(originMs, usage.timestamp, usage.durationMs),
        status: 'success',
        inputHash: usage.inputHash,
        outputHash: usage.outputHash,
      };
    });

  const checkpoints = normalizeCheckpoints(input.checkpoints ?? [], originMs);

  const message = input.message ?? '';
  const response = input.response ?? { content: '' };
  const traceId = deriveTraceId(run.runId, {
    message,
    steps,
    toolCalls,
    checkpoints,
    response,
    routing: input.routing,
  });

  return toDeterministicValue({
    version: EVAL_ARTIFACT_VERSION,
    traceId,
    run: {
      runId: run.runId,
      sourceTraceId: run.traceId,
      hasError: run.hasError,
      isSlow: run.isSlow,
    },
    environment: input.environment,
    input: {
      message,
    },
    routing: input.routing ?? { method: 'unknown' },
    response: {
      content: response.content,
      role: getResponseRole(response),
      metadata: toDeterministicValue(sanitizeVolatile(getResponseMetadata(response)) as Record<string, unknown>),
    },
    steps,
    toolCalls,
    checkpoints,
    handoffs: [],
  });
}

export function normalizeLegacyGoldenTrace(input: NormalizeLegacyTraceInput): EvaluationArtifact {
  const { trace } = input;
  const runId = input.runId ?? stableTupleId(['legacy', trace.metadata.timestamp]);

  const originMs = collectOrigin(
    [trace.metadata.timestamp],
    trace.trace.spans.flatMap((span) => [span.startTime, span.endTime]),
    trace.trace.toolCalls.flatMap((tool) => [tool.timing.startTime, tool.timing.endTime]),
    trace.trace.handoffs.flatMap((handoff) => [handoff.timing.startTime, handoff.timing.endTime]),
    input.checkpoints?.map((checkpoint) => toMs(checkpoint.createdAt)) ?? []
  );

  const steps: EvalStepArtifact[] = [...trace.trace.spans]
    .sort((a, b) => a.startTime - b.startTime)
    .map((span, index) => ({
      id: stableTupleId(['step', index, span.name]),
      index,
      name: span.name,
      status: span.status.code === 'error' ? 'error' : 'success',
      timing: toTiming(originMs, span.startTime, span.duration),
      metadata: toDeterministicValue(
        sanitizeVolatile({
          attributes: span.attributes,
          events: span.events,
          kind: span.kind,
          status: span.status,
        }) as Record<string, unknown>
      ),
    }));

  const toolOrdinals = new Map<string, number>();
  const toolCalls: EvalToolCallArtifact[] = trace.trace.toolCalls
    .slice()
    .sort((a, b) => a.timing.startTime - b.timing.startTime)
    .map((toolCall) => {
      const stepIndex = steps.findIndex((step) => {
        const start = step.timing.offsetMs + originMs;
        const end = start + step.timing.durationMs;
        return toolCall.timing.startTime >= start && toolCall.timing.startTime <= end;
      });

      const scopedStepIndex = stepIndex >= 0 ? stepIndex : -1;
      const key = `${scopedStepIndex}:${toolCall.toolId}`;
      const ordinal = toolOrdinals.get(key) ?? 0;
      toolOrdinals.set(key, ordinal + 1);

      return {
        id: stableTupleId([scopedStepIndex, toolCall.toolId, ordinal]),
        toolId: toolCall.toolId,
        stepIndex: scopedStepIndex,
        callOrdinal: ordinal,
        timing: toTiming(originMs, toolCall.timing.startTime, toolCall.timing.duration),
        status: toolCall.status,
        error: toolCall.error,
        args: toDeterministicValue(sanitizeVolatile(toolCall.args) as Record<string, unknown>),
        result: toDeterministicValue(sanitizeVolatile(toolCall.result)),
      };
    });

  const handoffs: EvalHandoffArtifact[] = trace.trace.handoffs
    .slice()
    .sort((a, b) => a.timing.startTime - b.timing.startTime)
    .map((handoff, index) => ({
      id: stableTupleId(['handoff', index, handoff.toAgent]),
      fromAgent: handoff.fromAgent,
      toAgent: handoff.toAgent,
      message: handoff.message,
      depth: handoff.depth,
      timing: toTiming(originMs, handoff.timing.startTime, handoff.timing.duration),
    }));

  const checkpoints = normalizeCheckpoints(input.checkpoints ?? [], originMs);

  const normalized = {
    version: EVAL_ARTIFACT_VERSION,
    traceId: deriveTraceId(runId, {
      message: trace.trace.message,
      routing: trace.trace.routing,
      response: trace.trace.response,
      steps,
      toolCalls,
      handoffs,
      checkpoints,
    }),
    run: {
      runId,
      hasError: steps.some((step) => step.status === 'error') || toolCalls.some((tool) => tool.status === 'error'),
      isSlow: false,
    },
    environment: input.environment,
    input: {
      message: trace.trace.message,
    },
    routing: toDeterministicValue(sanitizeVolatile(trace.trace.routing) as EvalRoutingArtifact),
    response: {
      content: trace.trace.response.content,
      metadata: toDeterministicValue(sanitizeVolatile(trace.trace.response) as Record<string, unknown>),
    },
    steps,
    toolCalls,
    checkpoints,
    handoffs,
  } satisfies EvaluationArtifact;

  return toDeterministicValue(normalized);
}

export function normalizeCheckpointsFromRun(
  checkpoints: ReadonlyArray<Checkpoint>,
  originMs: number
): EvalCheckpointArtifact[] {
  return normalizeCheckpointsFromStorage(checkpoints, originMs);
}
