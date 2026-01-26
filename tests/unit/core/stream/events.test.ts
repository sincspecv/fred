import { describe, it, expect } from 'bun:test';
import {
  makeStepStartEvent,
  makeStepEndEvent,
  makeStepCompleteEvent,
  makeStreamErrorEvent,
  makeTokenEvent,
  makeToolCallEvent,
  makeToolResultEvent,
  makeToolErrorEvent,
} from '../../../../src/core/stream/events';

describe('Stream Event Factories', () => {
  const runId = 'run_123';
  const threadId = 'thread_456';
  const messageId = 'msg_789';
  const sequence = 10;
  const emittedAt = Date.now();

  describe('makeStepStartEvent', () => {
    it('creates step-start event with all required fields', () => {
      const event = makeStepStartEvent({
        runId,
        threadId,
        stepIndex: 0,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('step-start');
      expect(event.runId).toBe(runId);
      expect(event.threadId).toBe(threadId);
      expect(event.stepIndex).toBe(0);
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });

    it('creates step-start event without threadId', () => {
      const event = makeStepStartEvent({
        runId,
        stepIndex: 1,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('step-start');
      expect(event.threadId).toBeUndefined();
      expect(event.stepIndex).toBe(1);
    });
  });

  describe('makeStepEndEvent', () => {
    it('creates step-end event with all required fields', () => {
      const event = makeStepEndEvent({
        runId,
        threadId,
        stepIndex: 2,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('step-end');
      expect(event.runId).toBe(runId);
      expect(event.threadId).toBe(threadId);
      expect(event.stepIndex).toBe(2);
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });

  describe('makeStepCompleteEvent', () => {
    it('creates step-complete event with all required fields', () => {
      const event = makeStepCompleteEvent({
        runId,
        threadId,
        stepIndex: 3,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('step-complete');
      expect(event.runId).toBe(runId);
      expect(event.threadId).toBe(threadId);
      expect(event.stepIndex).toBe(3);
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });

  describe('makeStreamErrorEvent', () => {
    it('creates stream-error event with error message', () => {
      const event = makeStreamErrorEvent({
        runId,
        threadId,
        stepIndex: 1,
        messageId,
        error: 'Connection timeout',
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('stream-error');
      expect(event.runId).toBe(runId);
      expect(event.threadId).toBe(threadId);
      expect(event.stepIndex).toBe(1);
      expect(event.messageId).toBe(messageId);
      expect(event.error).toBe('Connection timeout');
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });

    it('creates stream-error event with partial text', () => {
      const event = makeStreamErrorEvent({
        runId,
        threadId,
        stepIndex: 0,
        messageId,
        error: 'Stream interrupted',
        partialText: 'Hello wor',
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('stream-error');
      expect(event.error).toBe('Stream interrupted');
      expect(event.partialText).toBe('Hello wor');
    });

    it('creates stream-error event without messageId', () => {
      const event = makeStreamErrorEvent({
        runId,
        threadId,
        stepIndex: 0,
        error: 'Early failure',
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('stream-error');
      expect(event.messageId).toBeUndefined();
      expect(event.error).toBe('Early failure');
    });
  });

  describe('makeTokenEvent', () => {
    it('creates token event with delta and accumulated text', () => {
      const event = makeTokenEvent({
        runId,
        threadId,
        messageId,
        step: 0,
        delta: 'Hello',
        accumulated: 'Hello',
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('token');
      expect(event.runId).toBe(runId);
      expect(event.messageId).toBe(messageId);
      expect(event.step).toBe(0);
      expect(event.delta).toBe('Hello');
      expect(event.accumulated).toBe('Hello');
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });

  describe('makeToolCallEvent', () => {
    it('creates tool-call event with all fields', () => {
      const startedAt = Date.now();
      const event = makeToolCallEvent({
        runId,
        threadId,
        messageId,
        step: 1,
        toolCallId: 'tc_001',
        toolName: 'calculator',
        input: { expression: '2 + 2' },
        startedAt,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('tool-call');
      expect(event.runId).toBe(runId);
      expect(event.messageId).toBe(messageId);
      expect(event.step).toBe(1);
      expect(event.toolCallId).toBe('tc_001');
      expect(event.toolName).toBe('calculator');
      expect(event.input).toEqual({ expression: '2 + 2' });
      expect(event.startedAt).toBe(startedAt);
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });

  describe('makeToolResultEvent', () => {
    it('creates tool-result event with all fields', () => {
      const completedAt = Date.now();
      const event = makeToolResultEvent({
        runId,
        threadId,
        messageId,
        step: 1,
        toolCallId: 'tc_001',
        toolName: 'calculator',
        output: 4,
        completedAt,
        durationMs: 50,
        metadata: { coerced: false },
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('tool-result');
      expect(event.runId).toBe(runId);
      expect(event.messageId).toBe(messageId);
      expect(event.step).toBe(1);
      expect(event.toolCallId).toBe('tc_001');
      expect(event.toolName).toBe('calculator');
      expect(event.output).toBe(4);
      expect(event.completedAt).toBe(completedAt);
      expect(event.durationMs).toBe(50);
      expect(event.metadata).toEqual({ coerced: false });
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });

  describe('makeToolErrorEvent', () => {
    it('creates tool-error event with error details', () => {
      const completedAt = Date.now();
      const event = makeToolErrorEvent({
        runId,
        threadId,
        messageId,
        step: 1,
        toolCallId: 'tc_002',
        toolName: 'broken_tool',
        error: {
          message: 'Tool execution failed',
          name: 'ToolError',
          stack: 'Error: Tool execution failed\n  at ...',
        },
        completedAt,
        durationMs: 100,
        sequence,
        emittedAt,
      });

      expect(event.type).toBe('tool-error');
      expect(event.runId).toBe(runId);
      expect(event.messageId).toBe(messageId);
      expect(event.step).toBe(1);
      expect(event.toolCallId).toBe('tc_002');
      expect(event.toolName).toBe('broken_tool');
      expect(event.error.message).toBe('Tool execution failed');
      expect(event.error.name).toBe('ToolError');
      expect(event.error.stack).toContain('Tool execution failed');
      expect(event.completedAt).toBe(completedAt);
      expect(event.durationMs).toBe(100);
      expect(event.sequence).toBe(sequence);
      expect(event.emittedAt).toBe(emittedAt);
    });
  });
});
