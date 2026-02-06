import { describe, expect, test } from 'bun:test';
import { parseSuiteManifest, runSuite } from '../../../../packages/core/src/eval/suite';
import type { GoldenTrace } from '../../../../packages/core/src/eval/golden-trace';

function buildTrace(intentId: string, responseContent = 'done'): GoldenTrace {
  return {
    version: '1.0',
    metadata: {
      timestamp: 1700000000,
      fredVersion: '0.3.0-test',
    },
    trace: {
      message: 'route this message',
      spans: [
        {
          name: 'pipeline.run',
          startTime: 10,
          endTime: 40,
          duration: 30,
          attributes: {},
          events: [],
          status: { code: 'ok' },
        },
      ],
      response: { content: responseContent },
      toolCalls: [],
      handoffs: [],
      routing: {
        method: 'intent.matching',
        agentId: `${intentId}-agent`,
        intentId,
        confidence: 0.9,
        matchType: 'semantic',
      },
    },
  };
}

describe('eval suite runner', () => {
  test('parses suite manifest from JSON and YAML', () => {
    const jsonManifest = JSON.stringify({
      name: 'intent-suite',
      cases: [{ name: 'case-a', assertions: [] }],
    });

    const yamlManifest = `
name: intent-suite
cases:
  - name: case-a
    assertions: []
`;

    const fromJson = parseSuiteManifest(jsonManifest);
    const fromYaml = parseSuiteManifest(yamlManifest);

    expect(fromJson.name).toBe('intent-suite');
    expect(fromYaml.name).toBe('intent-suite');
    expect(fromJson.cases).toHaveLength(1);
    expect(fromYaml.cases).toHaveLength(1);
  });

  test('aggregates mixed pass and fail cases without aborting', async () => {
    const manifest = {
      name: 'batch-suite',
      cases: [
        { name: 'pass-case', expectedIntent: 'billing.refund', assertions: [] },
        { name: 'compare-regression', expectedIntent: 'support.password.reset', assertions: [], compare: { enabled: true } },
        { name: 'hard-failure', expectedIntent: 'sales.lead.capture', assertions: [] },
      ],
    };

    const baseline = buildTrace('support.password.reset');
    const candidate = buildTrace('unknown.intent');

    const report = await runSuite(manifest, async (testCase, index) => {
      if (index === 0) {
        return {
          trace: buildTrace('billing.refund'),
          latencyMs: 25,
          tokenUsage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
        };
      }

      if (index === 1) {
        return {
          trace: buildTrace('unexpected.intent'),
          baseline,
          candidate,
          latencyMs: 40,
          tokenUsage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
        };
      }

      throw new Error(`executor failed for ${testCase.name}`);
    });

    expect(report.totals).toEqual({
      totalCases: 3,
      passedCases: 1,
      failedCases: 2,
      passRate: 0.3333,
    });

    expect(report.regressions).toEqual({
      comparedCases: 1,
      passedCases: 0,
      failedCases: 1,
      totalRegressions: 1,
    });

    expect(report.latency).toEqual({
      minMs: 0,
      maxMs: 40,
      avgMs: 21.6667,
      totalMs: 65,
    });

    expect(report.tokenUsage).toEqual({
      inputTokens: 21,
      outputTokens: 11,
      totalTokens: 32,
      avgTokensPerCase: 10.6667,
    });

    expect(report.cases.map((item) => item.name)).toEqual([
      'pass-case',
      'compare-regression',
      'hard-failure',
    ]);
    expect(report.cases[2]?.error).toContain('executor failed for hard-failure');

    expect(report.intentQuality.labels).toEqual([
      'billing.refund',
      'sales.lead.capture',
      'support.password.reset',
      'unexpected.intent',
      '__none__',
    ]);
    expect(report.intentQuality.totalCases).toBe(report.totals.totalCases);
    expect(report.intentQuality.confusionMatrix.matrix.flat().reduce((sum, value) => sum + value, 0)).toBe(3);
  });
});
