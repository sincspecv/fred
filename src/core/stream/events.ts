import type { ModelMessage } from '@effect/ai';

export type StreamEventType =
  | 'run-start'
  | 'message-start'
  | 'token'
  | 'tool-call'
  | 'tool-result'
  | 'tool-error'
  | 'usage'
  | 'message-end'
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
    previousMessages: ModelMessage[];
  };
}

export interface MessageStartEvent extends StreamEventBase {
  type: 'message-start';
  messageId: string;
  step: number;
  role: 'assistant';
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
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolErrorEvent
  | UsageEvent
  | MessageEndEvent
  | RunEndEvent;

export interface StreamEventEnvelope {
  events: StreamEvent[];
  lastSequence: number;
}
