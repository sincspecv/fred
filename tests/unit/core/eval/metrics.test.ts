import { describe, expect, test } from 'bun:test';
import {
  NONE_INTENT_LABEL,
  buildConfusionMatrix,
  calculateIntentMetrics,
  normalizeIntentLabel,
} from '../../../../packages/core/src/eval/metrics';

describe('eval intent metrics', () => {
  test('normalizes empty labels to __none__ fallback', () => {
    expect(normalizeIntentLabel(undefined)).toBe(NONE_INTENT_LABEL);
    expect(normalizeIntentLabel(null)).toBe(NONE_INTENT_LABEL);
    expect(normalizeIntentLabel('   ')).toBe(NONE_INTENT_LABEL);
    expect(normalizeIntentLabel('support.password.reset')).toBe('support.password.reset');
  });

  test('builds confusion matrix with union of expected and predicted labels', () => {
    const matrix = buildConfusionMatrix([
      { expectedIntent: 'billing.refund', predictedIntent: 'billing.refund' },
      { expectedIntent: 'billing.refund', predictedIntent: 'support.password.reset' },
      { expectedIntent: 'support.password.reset', predictedIntent: 'support.password.reset' },
      { expectedIntent: undefined, predictedIntent: 'unexpected.intent' },
      { expectedIntent: 'sales.lead.capture', predictedIntent: undefined },
    ]);

    expect(matrix.labels).toEqual([
      'billing.refund',
      'sales.lead.capture',
      'support.password.reset',
      'unexpected.intent',
      '__none__',
    ]);

    const totalFromMatrix = matrix.matrix
      .flat()
      .reduce((sum, value) => sum + value, 0);

    expect(totalFromMatrix).toBe(5);
    expect(matrix.totalCases).toBe(5);
    expect(matrix.correctCases).toBe(2);
    expect(matrix.accuracy).toBe(0.4);
    expect(matrix.rows.find((row) => row.expected === '__none__')?.counts['unexpected.intent']).toBe(1);
  });

  test('calculates per-intent precision, recall, and accuracy', () => {
    const report = calculateIntentMetrics([
      { expectedIntent: 'billing.refund', predictedIntent: 'billing.refund' },
      { expectedIntent: 'billing.refund', predictedIntent: 'support.password.reset' },
      { expectedIntent: 'support.password.reset', predictedIntent: 'support.password.reset' },
      { expectedIntent: undefined, predictedIntent: 'unexpected.intent' },
      { expectedIntent: 'sales.lead.capture', predictedIntent: undefined },
    ]);

    expect(report.totalCases).toBe(5);
    expect(report.correctCases).toBe(2);
    expect(report.accuracy).toBe(0.4);

    const billing = report.perIntent.find((metric) => metric.label === 'billing.refund');
    expect(billing).toEqual({
      label: 'billing.refund',
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 1,
      trueNegatives: 3,
      precision: 1,
      recall: 0.5,
      accuracy: 0.8,
      support: 2,
      predicted: 1,
    });

    const unexpected = report.perIntent.find((metric) => metric.label === 'unexpected.intent');
    expect(unexpected).toEqual({
      label: 'unexpected.intent',
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 0,
      trueNegatives: 4,
      precision: 0,
      recall: 0,
      accuracy: 0.8,
      support: 0,
      predicted: 1,
    });
  });
});
