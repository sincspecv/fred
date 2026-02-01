import type { AgentMessage, AgentResponse } from '../agent/agent';
import type { StreamEvent } from '../stream/events';

/**
 * Context for generating synthetic stream events
 */
export interface SyntheticStreamContext {
  conversationId: string;
  message: string;
  previousMessages: AgentMessage[];
  response: AgentResponse;
}

/**
 * Stream ID generator state
 */
export interface StreamIdGenerator {
  runId: string;
  messageId: string;
  startedAt: number;
  sequence: number;
}

/**
 * Create a new stream ID generator with unique IDs
 */
export function createStreamIdGenerator(): StreamIdGenerator {
  const startedAt = Date.now();
  return {
    runId: `run_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
    messageId: `msg_${startedAt}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt,
    sequence: 0,
  };
}

/**
 * Generate synthetic stream events for a non-streaming response.
 * Creates the full sequence: run-start, message-start, token?, usage?, message-end, run-end
 */
export function generateSyntheticStreamEvents(
  ctx: SyntheticStreamContext,
  idGen: StreamIdGenerator
): StreamEvent[] {
  const events: StreamEvent[] = [];
  let sequence = idGen.sequence;

  // run-start
  events.push({
    type: 'run-start',
    sequence: sequence++,
    emittedAt: idGen.startedAt,
    runId: idGen.runId,
    threadId: ctx.conversationId,
    input: {
      message: ctx.message,
      previousMessages: ctx.previousMessages,
    },
    startedAt: idGen.startedAt,
  });

  // message-start
  events.push({
    type: 'message-start',
    sequence: sequence++,
    emittedAt: idGen.startedAt,
    runId: idGen.runId,
    threadId: ctx.conversationId,
    messageId: idGen.messageId,
    step: 0,
    role: 'assistant',
  });

  // token (if there's content)
  if (ctx.response.content) {
    events.push({
      type: 'token',
      sequence: sequence++,
      emittedAt: Date.now(),
      runId: idGen.runId,
      threadId: ctx.conversationId,
      messageId: idGen.messageId,
      step: 0,
      delta: ctx.response.content,
      accumulated: ctx.response.content,
    });
  }

  // usage (if available)
  if (ctx.response.usage) {
    events.push({
      type: 'usage',
      sequence: sequence++,
      emittedAt: Date.now(),
      runId: idGen.runId,
      threadId: ctx.conversationId,
      messageId: idGen.messageId,
      step: 0,
      usage: ctx.response.usage,
    });
  }

  const finishedAt = Date.now();

  // message-end
  events.push({
    type: 'message-end',
    sequence: sequence++,
    emittedAt: finishedAt,
    runId: idGen.runId,
    threadId: ctx.conversationId,
    messageId: idGen.messageId,
    step: 0,
    finishedAt,
    finishReason: 'stop',
  });

  // run-end
  events.push({
    type: 'run-end',
    sequence: sequence++,
    emittedAt: finishedAt,
    runId: idGen.runId,
    threadId: ctx.conversationId,
    finishedAt,
    durationMs: finishedAt - idGen.startedAt,
    result: {
      content: ctx.response.content,
      toolCalls: ctx.response.toolCalls,
      usage: ctx.response.usage,
    },
  });

  // Update sequence in generator
  idGen.sequence = sequence;

  return events;
}
