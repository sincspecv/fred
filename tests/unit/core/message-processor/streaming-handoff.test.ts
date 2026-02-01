import { describe, it, expect, beforeEach } from 'bun:test';
import { Stream } from 'effect';
import type { AgentInstance, AgentMessage, AgentResponse } from '../../../../packages/core/src/agent/agent';
import type {
  StreamEvent,
  HandoffStartEvent,
  RunEndEvent,
} from '../../../../packages/core/src/stream/events';

describe('Streaming Handoff Events', () => {
  describe('HandoffStartEvent type', () => {
    it('should have correct structure', () => {
      const event: HandoffStartEvent = {
        type: 'handoff-start',
        runId: 'run_123',
        threadId: 'thread_456',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        message: 'Hello from A',
        context: { key: 'value' },
        handoffDepth: 1,
        sequence: 10,
        emittedAt: Date.now(),
      };

      expect(event.type).toBe('handoff-start');
      expect(event.fromAgentId).toBe('agent-a');
      expect(event.toAgentId).toBe('agent-b');
      expect(event.handoffDepth).toBe(1);
    });

    it('should allow optional context', () => {
      const event: HandoffStartEvent = {
        type: 'handoff-start',
        runId: 'run_123',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        message: 'Hello',
        handoffDepth: 0,
        sequence: 0,
        emittedAt: Date.now(),
      };

      expect(event.context).toBeUndefined();
    });
  });

  describe('RunEndEvent with handoff', () => {
    it('should include handoff information when agent calls handoff_to_agent', () => {
      const event: RunEndEvent = {
        type: 'run-end',
        runId: 'run_123',
        sequence: 15,
        emittedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 500,
        result: {
          content: 'I will transfer you to the specialist.',
          toolCalls: [
            {
              toolId: 'handoff_to_agent',
              args: { agentId: 'specialist-agent', message: 'User needs help' },
              result: {
                type: 'handoff',
                agentId: 'specialist-agent',
                message: 'User needs help',
              },
            },
          ],
          handoff: {
            type: 'handoff',
            agentId: 'specialist-agent',
            message: 'User needs help',
          },
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        },
      };

      expect(event.result.handoff).toBeDefined();
      expect(event.result.handoff?.agentId).toBe('specialist-agent');
      expect(event.result.handoff?.message).toBe('User needs help');
    });

    it('should not include handoff when no handoff_to_agent called', () => {
      const event: RunEndEvent = {
        type: 'run-end',
        runId: 'run_123',
        sequence: 10,
        emittedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 300,
        result: {
          content: 'Here is the answer.',
          toolCalls: [],
        },
      };

      expect(event.result.handoff).toBeUndefined();
    });
  });

  describe('Event type discrimination', () => {
    it('should correctly discriminate handoff-start events', () => {
      const events: StreamEvent[] = [
        {
          type: 'run-start',
          runId: 'run_1',
          sequence: 0,
          emittedAt: Date.now(),
          startedAt: Date.now(),
          input: { message: 'Hello', previousMessages: [] },
        },
        {
          type: 'handoff-start',
          runId: 'run_1',
          sequence: 5,
          emittedAt: Date.now(),
          fromAgentId: 'agent-a',
          toAgentId: 'agent-b',
          message: 'Hello',
          handoffDepth: 1,
        },
        {
          type: 'run-end',
          runId: 'run_1',
          sequence: 10,
          emittedAt: Date.now(),
          finishedAt: Date.now(),
          durationMs: 1000,
          result: {
            content: 'Final answer',
          },
        },
      ];

      const handoffEvents = events.filter((e): e is HandoffStartEvent => e.type === 'handoff-start');
      expect(handoffEvents).toHaveLength(1);
      expect(handoffEvents[0].fromAgentId).toBe('agent-a');
    });
  });

  describe('Handoff depth tracking', () => {
    it('should increment handoff depth for chained handoffs', () => {
      const handoff1: HandoffStartEvent = {
        type: 'handoff-start',
        runId: 'run_1',
        sequence: 5,
        emittedAt: Date.now(),
        fromAgentId: 'router',
        toAgentId: 'specialist-a',
        message: 'Help needed',
        handoffDepth: 1,
      };

      const handoff2: HandoffStartEvent = {
        type: 'handoff-start',
        runId: 'run_1',
        sequence: 15,
        emittedAt: Date.now(),
        fromAgentId: 'specialist-a',
        toAgentId: 'specialist-b',
        message: 'Need escalation',
        handoffDepth: 2,
      };

      expect(handoff2.handoffDepth).toBe(handoff1.handoffDepth + 1);
    });
  });
});

describe('makeHandoffStartEvent factory', () => {
  it('should create a valid HandoffStartEvent', async () => {
    const { makeHandoffStartEvent } = await import('../../../../packages/core/src/stream/events');

    const event = makeHandoffStartEvent({
      runId: 'run_abc',
      threadId: 'thread_xyz',
      fromAgentId: 'source-agent',
      toAgentId: 'target-agent',
      message: 'Transfer message',
      context: { reason: 'escalation' },
      handoffDepth: 2,
      sequence: 20,
      emittedAt: 1234567890,
    });

    expect(event.type).toBe('handoff-start');
    expect(event.runId).toBe('run_abc');
    expect(event.threadId).toBe('thread_xyz');
    expect(event.fromAgentId).toBe('source-agent');
    expect(event.toAgentId).toBe('target-agent');
    expect(event.message).toBe('Transfer message');
    expect(event.context).toEqual({ reason: 'escalation' });
    expect(event.handoffDepth).toBe(2);
    expect(event.sequence).toBe(20);
    expect(event.emittedAt).toBe(1234567890);
  });

  it('should work without optional fields', async () => {
    const { makeHandoffStartEvent } = await import('../../../../packages/core/src/stream/events');

    const event = makeHandoffStartEvent({
      runId: 'run_123',
      fromAgentId: 'a',
      toAgentId: 'b',
      message: 'hi',
      handoffDepth: 0,
      sequence: 0,
      emittedAt: Date.now(),
    });

    expect(event.threadId).toBeUndefined();
    expect(event.context).toBeUndefined();
  });
});
