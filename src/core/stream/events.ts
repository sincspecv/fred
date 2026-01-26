import type { Prompt } from '@effect/ai';

export type StreamEventType =
  | 'run-start'
  | 'message-start'
  | 'step-start'
  | 'token'
  | 'tool-call'
  | 'tool-result'
  | 'tool-error'
  | 'usage'
  | 'message-end'
  | 'step-end'
  | 'step-complete'
  | 'stream-error'
  | 'run-end';

export interface StreamEventBase {
  type: StreamEventType;
  sequence: number;
  emittedAt: number;
  runId: string;
  threadId?: string;
}

export interface RunStartEvent extends StreamEventBase {
  type: 'run-start';
  startedAt: number;
  input: {
    message: string;
    previousMessages: Prompt.MessageEncoded[];
  };
}

export interface MessageStartEvent extends StreamEventBase {
  type: 'message-start';
  messageId: string;
  step: number;
  role: 'assistant';
}

export interface StepStartEvent extends StreamEventBase {
  type: 'step-start';
  stepIndex: number;
}

export interface StepEndEvent extends StreamEventBase {
  type: 'step-end';
  stepIndex: number;
}

export interface StepCompleteEvent extends StreamEventBase {
  type: 'step-complete';
  stepIndex: number;
}

export interface TokenEvent extends StreamEventBase {
  type: 'token';
  messageId: string;
  step: number;
  delta: string;
  accumulated: string;
}

export interface ToolCallEvent extends StreamEventBase {
  type: 'tool-call';
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  startedAt: number;
}

export interface ToolResultEvent extends StreamEventBase {
  type: 'tool-result';
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  output: unknown;
  completedAt: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface ToolErrorEvent extends StreamEventBase {
  type: 'tool-error';
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  error: {
    message: string;
    name?: string;
    stack?: string;
  };
  completedAt: number;
  durationMs: number;
}

export interface UsageEvent extends StreamEventBase {
  type: 'usage';
  messageId: string;
  step: number;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface MessageEndEvent extends StreamEventBase {
  type: 'message-end';
  messageId: string;
  step: number;
  finishedAt: number;
  finishReason?: string;
}

export interface StreamErrorEvent extends StreamEventBase {
  type: 'stream-error';
  stepIndex: number;
  messageId?: string;
  error: string;
  partialText?: string;
}

export interface RunEndEvent extends StreamEventBase {
  type: 'run-end';
  finishedAt: number;
  durationMs: number;
  result: {
    content: string;
    toolCalls?: Array<{
      toolId: string;
      args: Record<string, unknown>;
      result?: unknown;
      error?: {
        message: string;
        name?: string;
        stack?: string;
      };
      metadata?: Record<string, unknown>;
    }>;
    handoff?: unknown;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
}

export type StreamEvent =
  | RunStartEvent
  | MessageStartEvent
  | StepStartEvent
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolErrorEvent
  | UsageEvent
  | MessageEndEvent
  | StepEndEvent
  | StepCompleteEvent
  | StreamErrorEvent
  | RunEndEvent;

export interface StreamEventEnvelope {
  events: StreamEvent[];
  lastSequence: number;
}

// Event factory helpers
export const makeStepStartEvent = ({
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  stepIndex: number;
  sequence: number;
  emittedAt: number;
}): StepStartEvent => ({
  type: 'step-start',
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
});

export const makeStepEndEvent = ({
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  stepIndex: number;
  sequence: number;
  emittedAt: number;
}): StepEndEvent => ({
  type: 'step-end',
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
});

export const makeStepCompleteEvent = ({
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  stepIndex: number;
  sequence: number;
  emittedAt: number;
}): StepCompleteEvent => ({
  type: 'step-complete',
  runId,
  threadId,
  stepIndex,
  sequence,
  emittedAt,
});

export const makeTokenEvent = ({
  runId,
  threadId,
  messageId,
  step,
  delta,
  accumulated,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  messageId: string;
  step: number;
  delta: string;
  accumulated: string;
  sequence: number;
  emittedAt: number;
}): TokenEvent => ({
  type: 'token',
  runId,
  threadId,
  messageId,
  step,
  delta,
  accumulated,
  sequence,
  emittedAt,
});

export const makeToolCallEvent = ({
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  input,
  startedAt,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  startedAt: number;
  sequence: number;
  emittedAt: number;
}): ToolCallEvent => ({
  type: 'tool-call',
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  input,
  startedAt,
  sequence,
  emittedAt,
});

export const makeToolResultEvent = ({
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  output,
  completedAt,
  durationMs,
  metadata,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  output: unknown;
  completedAt: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
  sequence: number;
  emittedAt: number;
}): ToolResultEvent => ({
  type: 'tool-result',
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  output,
  completedAt,
  durationMs,
  metadata,
  sequence,
  emittedAt,
});

export const makeToolErrorEvent = ({
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  error,
  completedAt,
  durationMs,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  messageId: string;
  step: number;
  toolCallId: string;
  toolName: string;
  error: {
    message: string;
    name?: string;
    stack?: string;
  };
  completedAt: number;
  durationMs: number;
  sequence: number;
  emittedAt: number;
}): ToolErrorEvent => ({
  type: 'tool-error',
  runId,
  threadId,
  messageId,
  step,
  toolCallId,
  toolName,
  error,
  completedAt,
  durationMs,
  sequence,
  emittedAt,
});

export const makeStreamErrorEvent = ({
  runId,
  threadId,
  stepIndex,
  messageId,
  error,
  partialText,
  sequence,
  emittedAt,
}: {
  runId: string;
  threadId?: string;
  stepIndex: number;
  messageId?: string;
  error: string;
  partialText?: string;
  sequence: number;
  emittedAt: number;
}): StreamErrorEvent => ({
  type: 'stream-error',
  runId,
  threadId,
  stepIndex,
  messageId,
  error,
  partialText,
  sequence,
  emittedAt,
});
