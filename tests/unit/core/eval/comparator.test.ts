import { describe, expect, test } from 'bun:test';
import { compare } from '../../../../packages/core/src/eval/comparator';
import type { GoldenTrace } from '../../../../packages/core/src/eval/golden-trace';

function buildTrace(overrides?: Partial<GoldenTrace>): GoldenTrace {
  const base: GoldenTrace = {
    version: '1.0',
    metadata: {
      timestamp: 1700000000,
      fredVersion: '0.3.0-test',
    },
    trace: {
      message: 'route this',
      spans: [
        {
          name: 'route-step',
          startTime: 1000,
          endTime: 1010,
          duration: 10,
          attributes: {
            traceId: 'volatile-id-a',
            timestamp: 1000,
          },
          events: [],
          status: { code: 'ok' },
        },
      ],
      response: {
        content: 'Support response',
      },
      toolCalls: [
        {
          toolId: 'lookup.user',
          args: { userId: 'u-1' },
          timing: { startTime: 1002, endTime: 1004, duration: 2 },
          status: 'success',
        },
      ],
      handoffs: [],
      routing: {
        method: 'intent.matching',
        intentId: 'support.password.reset',
        agentId: 'support-agent',
        confidence: 0.95,
        matchType: 'semantic',
      },
    },
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...(overrides?.metadata ?? {}),
    },
    trace: {
      ...base.trace,
      ...(overrides?.trace ?? {}),
    },
  };
}

describe('eval comparator', () => {
  test('ignores volatile fields and returns stable pass scorecard', () => {
    const baseline = buildTrace();
    const candidate = buildTrace({
      metadata: {
        timestamp: 1900000000,
        fredVersion: '0.3.0-test',
      },
      trace: {
        ...buildTrace().trace,
        spans: [
          {
            ...buildTrace().trace.spans[0]!,
            startTime: 2000,
            endTime: 2010,
            attributes: {
              traceId: 'volatile-id-b',
              timestamp: 2000,
            },
          },
        ],
        toolCalls: [
          {
            ...buildTrace().trace.toolCalls[0]!,
            timing: { startTime: 2002, endTime: 2004, duration: 2 },
          },
        ],
      },
    });

    const result = compare(baseline, candidate);

    expect(result.passed).toBe(true);
    expect(result.scorecard).toEqual({
      totalChecks: 6,
      passedChecks: 6,
      failedChecks: 0,
      regressions: [],
    });
  });

  test('returns deterministic scorecard and no delta for equivalent normalized traces', () => {
    const baseline = buildTrace();
    const candidate = buildTrace({
      metadata: {
        timestamp: 1711111111,
        fredVersion: '0.3.0-test',
      },
    });

    const first = compare(baseline, candidate);
    const second = compare(baseline, candidate);

    expect(first.scorecard).toEqual(second.scorecard);
    expect(first.details.delta).toBeUndefined();
    expect(second.details.delta).toBeUndefined();
  });

  test('flags routing regression while ignoring timestamp noise', () => {
    const baseline = buildTrace();
    const candidate = buildTrace({
      metadata: {
        timestamp: 1800000000,
        fredVersion: '0.3.0-test',
      },
      trace: {
        ...buildTrace().trace,
        spans: [
          {
            ...buildTrace().trace.spans[0]!,
            startTime: 3000,
            endTime: 3010,
          },
        ],
        toolCalls: [
          {
            ...buildTrace().trace.toolCalls[0]!,
            timing: { startTime: 3002, endTime: 3004, duration: 2 },
          },
        ],
        routing: {
          method: 'default.agent',
          agentId: 'fallback-agent',
        },
      },
    });

    const result = compare(baseline, candidate);

    expect(result.passed).toBe(false);
    expect(result.scorecard.failedChecks).toBe(1);
    expect(result.scorecard.regressions).toEqual([
      {
        check: 'routing',
        path: 'routing',
        message: 'Routing behavior changed',
      },
    ]);
  });
});
