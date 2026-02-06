import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createDefaultEvalCommandService } from '../../../packages/cli/src/eval';
import type { SuiteReport } from '../../../packages/core/src/eval';

describe('CLI eval suite with aggregate metrics', () => {
  const testDir = join(process.cwd(), '.tmp', 'test-eval-suite-full');
  const traceDir = join(testDir, 'traces');

  beforeEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true });
    }
    await mkdir(traceDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true });
    }
  });

  it('should return complete SuiteReport structure', async () => {
    const suitePath = join(testDir, 'suite.yaml');
    const manifest = {
      name: 'Full Test Suite',
      version: '1.0.0',
      cases: [
        {
          id: 'case-1',
          name: 'Test case 1',
          expectedIntent: 'greeting',
          assertions: [],
        },
        {
          id: 'case-2',
          name: 'Test case 2',
          expectedIntent: 'farewell',
          assertions: [],
        },
      ],
    };
    await writeFile(suitePath, JSON.stringify(manifest));

    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    const result = (await service.suite({ suitePath })) as SuiteReport;

    // Verify all required SuiteReport fields exist
    expect(result).toHaveProperty('suite');
    expect(result).toHaveProperty('totals');
    expect(result).toHaveProperty('latency');
    expect(result).toHaveProperty('tokenUsage');
    expect(result).toHaveProperty('regressions');
    expect(result).toHaveProperty('intentQuality');
    expect(result).toHaveProperty('cases');

    // Verify suite metadata
    expect(result.suite).toHaveProperty('name');
    expect(result.suite.name).toBe('Full Test Suite');

    // Verify totals structure
    expect(result.totals).toHaveProperty('totalCases');
    expect(result.totals).toHaveProperty('passedCases');
    expect(result.totals).toHaveProperty('failedCases');
    expect(result.totals).toHaveProperty('passRate');
    expect(result.totals.totalCases).toBe(2);

    // Verify latency structure
    expect(result.latency).toHaveProperty('minMs');
    expect(result.latency).toHaveProperty('maxMs');
    expect(result.latency).toHaveProperty('avgMs');
    expect(result.latency).toHaveProperty('totalMs');

    // Verify token usage structure
    expect(result.tokenUsage).toHaveProperty('inputTokens');
    expect(result.tokenUsage).toHaveProperty('outputTokens');
    expect(result.tokenUsage).toHaveProperty('totalTokens');
    expect(result.tokenUsage).toHaveProperty('avgTokensPerCase');

    // Verify intent quality (confusion matrix)
    expect(result.intentQuality.confusionMatrix).toBeDefined();
    expect(result.intentQuality.perIntent).toBeDefined();
    expect(result.intentQuality.accuracy).toBeDefined();
    expect(Array.isArray(result.intentQuality.labels)).toBe(true);

    // Verify cases array
    expect(Array.isArray(result.cases)).toBe(true);
    expect(result.cases).toHaveLength(2);

    // Verify case-level details
    result.cases.forEach((caseReport: any) => {
      expect(caseReport).toHaveProperty('id');
      expect(caseReport).toHaveProperty('name');
      expect(caseReport).toHaveProperty('passed');
      expect(caseReport).toHaveProperty('latencyMs');
      expect(caseReport).toHaveProperty('tokenUsage');
    });
  });

  it('should not return placeholder message', async () => {
    const suitePath = join(testDir, 'suite.yaml');
    const manifest = {
      name: 'Placeholder Test',
      cases: [
        {
          name: 'Test case',
          assertions: [],
        },
      ],
    };
    await writeFile(suitePath, JSON.stringify(manifest));

    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    const result = (await service.suite({ suitePath })) as SuiteReport;

    // Should be a proper SuiteReport, not a placeholder
    expect(typeof result).toBe('object');
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('host');
    expect(result).not.toHaveProperty('placeholder');
    expect(result).toHaveProperty('totals');
    expect(result).toHaveProperty('intentQuality');
  });

  it('should include confusion matrix in intent diagnostics', async () => {
    const suitePath = join(testDir, 'suite.yaml');
    const manifest = {
      name: 'Intent Test Suite',
      cases: [
        { id: '1', name: 'Case 1', expectedIntent: 'greeting', assertions: [] },
        { id: '2', name: 'Case 2', expectedIntent: 'greeting', assertions: [] },
        { id: '3', name: 'Case 3', expectedIntent: 'farewell', assertions: [] },
      ],
    };
    await writeFile(suitePath, JSON.stringify(manifest));

    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    const result = (await service.suite({ suitePath })) as SuiteReport;

    // Confusion matrix should exist
    expect(result.intentQuality.confusionMatrix).toBeDefined();
    expect(typeof result.intentQuality.confusionMatrix).toBe('object');

    // Per-intent metrics should exist
    expect(result.intentQuality.perIntent).toBeDefined();
    expect(Array.isArray(result.intentQuality.perIntent)).toBe(true);

    // Overall accuracy should be a number
    expect(typeof result.intentQuality.accuracy).toBe('number');
    expect(typeof result.intentQuality.totalCases).toBe('number');
  });
});
