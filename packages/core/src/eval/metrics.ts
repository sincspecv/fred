export const NONE_INTENT_LABEL = '__none__';

export interface IntentLabelPair {
  expectedIntent?: string | null;
  predictedIntent?: string | null;
}

export interface IntentMetric {
  label: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  accuracy: number;
  support: number;
  predicted: number;
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
  rows: Array<{ expected: string; counts: Record<string, number> }>;
  totalCases: number;
  correctCases: number;
  accuracy: number;
}

export interface IntentMetricsReport {
  labels: string[];
  totalCases: number;
  correctCases: number;
  accuracy: number;
  confusionMatrix: ConfusionMatrix;
  perIntent: IntentMetric[];
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return round(numerator / denominator);
}

export function normalizeIntentLabel(label: string | null | undefined): string {
  const normalized = typeof label === 'string' ? label.trim() : '';
  return normalized.length > 0 ? normalized : NONE_INTENT_LABEL;
}

export function collectIntentLabels(pairs: ReadonlyArray<IntentLabelPair>): string[] {
  const labels = new Set<string>([NONE_INTENT_LABEL]);

  for (const pair of pairs) {
    labels.add(normalizeIntentLabel(pair.expectedIntent));
    labels.add(normalizeIntentLabel(pair.predictedIntent));
  }

  return [...labels].sort((a, b) => {
    if (a === NONE_INTENT_LABEL && b !== NONE_INTENT_LABEL) {
      return 1;
    }
    if (a !== NONE_INTENT_LABEL && b === NONE_INTENT_LABEL) {
      return -1;
    }
    return a.localeCompare(b);
  });
}

export function buildConfusionMatrix(pairs: ReadonlyArray<IntentLabelPair>): ConfusionMatrix {
  const labels = collectIntentLabels(pairs);
  const labelIndex = new Map<string, number>(labels.map((label, index) => [label, index]));
  const matrix = labels.map(() => labels.map(() => 0));

  for (const pair of pairs) {
    const expected = normalizeIntentLabel(pair.expectedIntent);
    const predicted = normalizeIntentLabel(pair.predictedIntent);
    const row = labelIndex.get(expected);
    const column = labelIndex.get(predicted);

    if (row !== undefined && column !== undefined) {
      matrix[row]![column] = matrix[row]![column]! + 1;
    }
  }

  const totalCases = pairs.length;
  const correctCases = labels.reduce((sum, label, index) => {
    const labelIdx = labelIndex.get(label);
    if (labelIdx === undefined) {
      return sum;
    }
    return sum + (matrix[index]![labelIdx] ?? 0);
  }, 0);

  const rows = labels.map((expected, rowIndex) => {
    const counts: Record<string, number> = {};
    labels.forEach((predicted, columnIndex) => {
      counts[predicted] = matrix[rowIndex]![columnIndex] ?? 0;
    });
    return { expected, counts };
  });

  return {
    labels,
    matrix,
    rows,
    totalCases,
    correctCases,
    accuracy: safeDivide(correctCases, totalCases),
  };
}

export function calculateIntentMetrics(pairs: ReadonlyArray<IntentLabelPair>): IntentMetricsReport {
  const confusionMatrix = buildConfusionMatrix(pairs);
  const labels = confusionMatrix.labels;
  const matrix = confusionMatrix.matrix;
  const totalCases = confusionMatrix.totalCases;

  const perIntent = labels.map((label, index) => {
    const tp = matrix[index]![index] ?? 0;

    let rowTotal = 0;
    let columnTotal = 0;

    for (let cursor = 0; cursor < labels.length; cursor += 1) {
      rowTotal += matrix[index]![cursor] ?? 0;
      columnTotal += matrix[cursor]![index] ?? 0;
    }

    const fn = rowTotal - tp;
    const fp = columnTotal - tp;
    const tn = totalCases - tp - fn - fp;

    return {
      label,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      precision: safeDivide(tp, tp + fp),
      recall: safeDivide(tp, tp + fn),
      accuracy: safeDivide(tp + tn, totalCases),
      support: rowTotal,
      predicted: columnTotal,
    } satisfies IntentMetric;
  });

  return {
    labels,
    totalCases,
    correctCases: confusionMatrix.correctCases,
    accuracy: confusionMatrix.accuracy,
    confusionMatrix,
    perIntent,
  };
}
