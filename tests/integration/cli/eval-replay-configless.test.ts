import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createDefaultEvalCommandService } from '../../../packages/cli/src/eval';

describe('CLI eval replay config-less mode', () => {
  const testDir = join(process.cwd(), '.tmp', 'test-eval-replay-configless');
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

  it('should replay without requiring config file', async () => {
    // Create a valid trace artifact
    const traceId = 'test-trace-configless';
    const traceFile = join(traceDir, `${traceId}.json`);
    const mockArtifact = {
      traceId,
      run: { runId: 'run-123', startTime: Date.now(), endTime: Date.now() },
      checkpoints: [
        { 
          step: 0, 
          stepName: 'start', 
          status: 'completed', 
          createdAt: new Date().toISOString(), 
          snapshot: { 
            pipelineId: 'pipe-1', 
            context: {} 
          } 
        }
      ],
      messages: [],
      toolCalls: [],
      routing: {},
      metadata: { version: '1.0.0', environment: 'test' },
    };
    await writeFile(traceFile, JSON.stringify(mockArtifact));

    // Create service WITHOUT config
    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
      // No configPath provided - this should work in config-less mode
    });

    // Should not throw config requirement error
    let errorMessage = '';
    try {
      await service.replay({ traceId });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // Should NOT fail with config requirement error
    expect(errorMessage).not.toContain('requires a Fred config file');
    expect(errorMessage).not.toContain('Provide --config');
    expect(errorMessage).not.toContain('FRED_CONFIG_PATH');
    expect(errorMessage).not.toContain('fred.config.yaml');
    expect(errorMessage).not.toContain('fred.config.json');
  });

  it('should provide clear error for missing trace, not missing config', async () => {
    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    let errorMessage = '';
    try {
      await service.replay({ traceId: 'non-existent-trace' });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // Should mention trace not found, not config
    expect(errorMessage).toMatch(/not found|trace|ReplayTraceNotFoundError/i);
    expect(errorMessage).not.toContain('requires a Fred config file');
  });

  it('should support --from-step without config', async () => {
    const traceId = 'test-trace-from-step';
    const traceFile = join(traceDir, `${traceId}.json`);
    const mockArtifact = {
      traceId,
      run: { runId: 'run-456', startTime: Date.now(), endTime: Date.now() },
      checkpoints: [
        { 
          step: 0, 
          stepName: 'step0', 
          status: 'completed', 
          createdAt: new Date().toISOString(), 
          snapshot: { pipelineId: 'pipe-1', context: { step: 0 } } 
        },
        { 
          step: 1, 
          stepName: 'step1', 
          status: 'completed', 
          createdAt: new Date().toISOString(), 
          snapshot: { pipelineId: 'pipe-1', context: { step: 1 } } 
        }
      ],
      messages: [],
      toolCalls: [],
      routing: {},
      metadata: { version: '1.0.0', environment: 'test' },
    };
    await writeFile(traceFile, JSON.stringify(mockArtifact));

    const service = createDefaultEvalCommandService({
      traceDirectory: traceDir,
    });

    // Should work with fromStep without config
    let errorMessage = '';
    try {
      await service.replay({ traceId, fromStep: 1 });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain('requires a Fred config file');
  });
});
