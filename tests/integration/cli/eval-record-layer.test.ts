import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createDefaultEvalCommandService } from '../../../packages/cli/src/eval';

describe('CLI eval record layer composition', () => {
  const testDir = join(process.cwd(), '.tmp', 'test-eval-record-layer');
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

  it('should compose layers without ObservabilityService not found error', async () => {
    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    let errorMessage = '';
    let errorName = '';
    
    try {
      // This will fail since there's no run in the observability store,
      // but it should NOT fail with ObservabilityService not found
      await service.record({ runId: 'non-existent-run' });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      errorName = error instanceof Error ? error.name : 'Unknown';
    }

    // Should NOT contain the layer composition error - this is the key test
    expect(errorMessage).not.toContain('ObservabilityService was not found');
    expect(errorMessage).not.toContain('Service not found: ObservabilityService');
    expect(errorMessage).not.toMatch(/Service not found/);
    
    // The error should be about the run not being found (or similar runtime error),
    // NOT a dependency injection error
    expect(errorName).not.toBe('RuntimeError');
    // Error message should indicate the actual problem, not a service wiring issue
    expect(errorMessage.length).toBeGreaterThan(0);
  });

  it('should construct service without throwing dependency errors', () => {
    // Layer graph construction should not throw
    expect(() => {
      createDefaultEvalCommandService({
        traceDirectory: traceDir,
      });
    }).not.toThrow();
  });
});
