import { describe, expect, test } from 'bun:test';
import { runAssertions } from '../../../../packages/core/src/eval/assertion-runner';
import type { GoldenTrace } from '../../../../packages/core/src/eval/golden-trace';

function createTrace(): GoldenTrace {
  return {
    version: '1.0',
    metadata: {
      timestamp: 1700000000,
      fredVersion: '0.3.0-test',
    },
    trace: {
      message: 'route this request',
      spans: [
        {
          name: 'checkpoint-step',
          startTime: 1000,
          endTime: 1010,
          duration: 10,
          attributes: {
            step: 2,
            status: 'paused',
          },
          events: [],
          status: {
            code: 'ok',
          },
        },
      ],
      response: {
        content: 'I can help reset your password quickly.',
        usage: {
          totalTokens: 42,
        },
      },
      toolCalls: [
        {
          toolId: 'lookup.user',
          args: { userId: 'u-1', includeHistory: true },
          timing: {
            startTime: 1002,
            endTime: 1004,
            duration: 2,
          },
          status: 'success',
          result: { ok: true },
        },
      ],
      handoffs: [],
      routing: {
        method: 'intent.matching',
        intentId: 'support.password.reset',
        agentId: 'support-agent',
        confidence: 0.96,
        matchType: 'semantic',
      },
    },
  };
}

describe('eval assertions', () => {
  test('passes tool, routing, response, and checkpoint assertions', async () => {
    const results = await runAssertions(createTrace(), [
      {
        type: 'tool.calls',
        expected: [{ toolId: 'lookup.user', argsContains: { userId: 'u-1' } }],
      },
      {
        type: 'routing',
        expected: {
          method: 'intent.matching',
          agentId: 'support-agent',
          intentId: 'support.password.reset',
        },
      },
      {
        type: 'response',
        pathEquals: {
          'usage.totalTokens': 42,
        },
        text: 'I can help you reset your password quickly.',
        semanticThreshold: 0.8,
      },
      {
        type: 'checkpoint',
        expected: {
          step: 2,
          status: 'paused',
        },
      },
    ]);

    expect(results.every((result) => result.passed)).toBe(true);
  });

  test('reports all missing expected tool calls in one result', async () => {
    const results = await runAssertions(createTrace(), [
      {
        type: 'tool.calls',
        expected: [
          { toolId: 'lookup.user' },
          { toolId: 'send.email' },
          { toolId: 'audit.log' },
        ],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.details?.missingExpectedCalls).toEqual([
      { toolId: 'send.email' },
      { toolId: 'audit.log' },
    ]);
  });

  test('fails routing and response assertions with detailed mismatches', async () => {
    const results = await runAssertions(createTrace(), [
      {
        type: 'routing',
        expected: {
          agentId: 'billing-agent',
        },
      },
      {
        type: 'response',
        pathEquals: {
          'usage.totalTokens': 999,
        },
      },
    ]);

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.details?.mismatches).toEqual([
      { field: 'agentId', expected: 'billing-agent', actual: 'support-agent' },
    ]);

    expect(results[1]?.passed).toBe(false);
    expect(results[1]?.message).toContain('structured path checks failed');
  });

  test('enforces configurable semantic threshold for response text assertions', async () => {
    const strict = await runAssertions(createTrace(), [
      {
        type: 'response',
        text: 'Completely unrelated answer about shipping labels.',
        semanticThreshold: 0.9,
      },
    ]);

    const relaxed = await runAssertions(createTrace(), [
      {
        type: 'response',
        text: 'I can help you reset your password quickly.',
        semanticThreshold: 0.7,
      },
    ]);

    expect(strict[0]?.passed).toBe(false);
    expect(relaxed[0]?.passed).toBe(true);
  });
});
