/**
 * Unit tests for pipeline executor checkpoint functionality.
 *
 * Tests the executor's ability to:
 * - Generate and track run IDs
 * - Write checkpoints after each step
 * - Skip checkpointing when disabled
 * - Resume from specific step with restored context
 */

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { executePipelineV2 } from '../../../../packages/core/src/pipeline/executor';
import type { ExtendedExecutionOptions } from '../../../../packages/core/src/pipeline/executor';
import type { PipelineConfigV2 } from '../../../../packages/core/src/pipeline/pipeline';
import type { PipelineContext } from '../../../../packages/core/src/pipeline/context';
import type { AgentManager } from '../../../../packages/core/src/agent/manager';
import type { CheckpointManager } from '../../../../packages/core/src/pipeline/checkpoint/manager';

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

function createMockAgent() {
  return {
    id: 'test-agent',
    processMessage: mock(async (input: string) => ({
      content: `Processed: ${input}`,
      toolCalls: [],
    })),
  };
}

function createMockAgentManager(): AgentManager {
  const agent = createMockAgent();
  return {
    getAgent: mock((id: string) => (id === 'test-agent' ? agent : undefined)),
  } as any;
}

function createMockCheckpointManager(): CheckpointManager & {
  saveCheckpoint: ReturnType<typeof mock>;
  generateRunId: ReturnType<typeof mock>;
} {
  return {
    generateRunId: mock(() => 'generated-run-id'),
    saveCheckpoint: mock(async () => {}),
    getLatestCheckpoint: mock(async () => null),
    updateStatus: mock(async () => {}),
    markCompleted: mock(async () => {}),
    markFailed: mock(async () => {}),
    getCheckpoint: mock(async () => null),
    deleteRun: mock(async () => {}),
    deleteExpired: mock(async () => 0),
    close: mock(async () => {}),
  } as any;
}

function createSimplePipelineConfig(stepCount: number = 2): PipelineConfigV2 {
  return {
    id: 'test-pipeline',
    steps: Array.from({ length: stepCount }, (_, i) => ({
      type: 'function' as const,
      name: `step-${i}`,
      fn: async (ctx: PipelineContext) => `result-${i}`,
    })),
  };
}

function createTestContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    pipelineId: 'test-pipeline',
    input: 'test input',
    outputs: { 'step-0': 'result-0', 'step-1': 'result-1' },
    history: [],
    metadata: { key: 'value' },
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Run ID Tests
// -----------------------------------------------------------------------------

describe('executePipelineV2 - Run ID', () => {
  it('generates runId and returns it in result', async () => {
    const agentManager = createMockAgentManager();
    const config = createSimplePipelineConfig(1);

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
    expect(typeof result.runId).toBe('string');
    expect(result.runId!.length).toBeGreaterThan(0);
  });

  it('uses provided runId when specified', async () => {
    const agentManager = createMockAgentManager();
    const config = createSimplePipelineConfig(1);

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      runId: 'custom-run-id',
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe('custom-run-id');
  });

  it('uses checkpointManager.generateRunId when available', async () => {
    const agentManager = createMockAgentManager();
    const checkpointManager = createMockCheckpointManager();
    const config = createSimplePipelineConfig(1);

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      checkpointManager,
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe('generated-run-id');
    expect(checkpointManager.generateRunId).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Checkpoint Writing Tests
// -----------------------------------------------------------------------------

describe('executePipelineV2 - Checkpoint Writing', () => {
  it('calls saveCheckpoint after each step when checkpointManager provided', async () => {
    const agentManager = createMockAgentManager();
    const checkpointManager = createMockCheckpointManager();
    const config = createSimplePipelineConfig(3);

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      checkpointManager,
    });

    expect(result.success).toBe(true);
    expect(checkpointManager.saveCheckpoint).toHaveBeenCalledTimes(3);

    // Verify checkpoint content for each step
    const calls = checkpointManager.saveCheckpoint.mock.calls;
    expect(calls[0][0]).toMatchObject({
      runId: 'generated-run-id',
      pipelineId: 'test-pipeline',
      step: 0,
      status: 'in_progress',
    });
    expect(calls[1][0]).toMatchObject({
      runId: 'generated-run-id',
      pipelineId: 'test-pipeline',
      step: 1,
      status: 'in_progress',
    });
    expect(calls[2][0]).toMatchObject({
      runId: 'generated-run-id',
      pipelineId: 'test-pipeline',
      step: 2,
      status: 'in_progress',
    });
  });

  it('does NOT call saveCheckpoint when checkpointManager undefined', async () => {
    const agentManager = createMockAgentManager();
    const config = createSimplePipelineConfig(2);

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      // No checkpointManager
    });

    expect(result.success).toBe(true);
    // No assertions about saveCheckpoint because it doesn't exist
  });

  it('does NOT call saveCheckpoint when config.checkpoint.enabled is false', async () => {
    const agentManager = createMockAgentManager();
    const checkpointManager = createMockCheckpointManager();
    const config: PipelineConfigV2 = {
      ...createSimplePipelineConfig(2),
      checkpoint: { enabled: false },
    };

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      checkpointManager,
    });

    expect(result.success).toBe(true);
    expect(checkpointManager.saveCheckpoint).not.toHaveBeenCalled();
  });

  it('uses custom TTL when config.checkpoint.ttlMs specified', async () => {
    const agentManager = createMockAgentManager();
    const checkpointManager = createMockCheckpointManager();
    const config: PipelineConfigV2 = {
      ...createSimplePipelineConfig(1),
      checkpoint: { ttlMs: 3600000 }, // 1 hour
    };

    const beforeExecution = Date.now();
    await executePipelineV2(config, 'test input', {
      agentManager,
      checkpointManager,
    });
    const afterExecution = Date.now();

    expect(checkpointManager.saveCheckpoint).toHaveBeenCalledTimes(1);
    const call = checkpointManager.saveCheckpoint.mock.calls[0][0];
    expect(call.expiresAt).toBeInstanceOf(Date);

    // Verify expiry is approximately 1 hour from now
    const expiresAtTime = call.expiresAt.getTime();
    expect(expiresAtTime).toBeGreaterThanOrEqual(beforeExecution + 3600000);
    expect(expiresAtTime).toBeLessThanOrEqual(afterExecution + 3600000);
  });

  it('logs warning but does not fail pipeline when checkpoint save fails', async () => {
    const agentManager = createMockAgentManager();
    const checkpointManager = createMockCheckpointManager();
    checkpointManager.saveCheckpoint = mock(async () => {
      throw new Error('Storage unavailable');
    });

    const config = createSimplePipelineConfig(2);

    // Capture console.warn
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };

    try {
      const result = await executePipelineV2(config, 'test input', {
        agentManager,
        checkpointManager,
      });

      expect(result.success).toBe(true);
      expect(warnings.some((w) => w.includes('[Checkpoint]'))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

// -----------------------------------------------------------------------------
// Resume (startStep) Tests
// -----------------------------------------------------------------------------

describe('executePipelineV2 - Resume from startStep', () => {
  it('skips steps before startStep', async () => {
    const agentManager = createMockAgentManager();
    const executedSteps: number[] = [];

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async () => {
            executedSteps.push(0);
            return 'result-0';
          },
        },
        {
          type: 'function',
          name: 'step-1',
          fn: async () => {
            executedSteps.push(1);
            return 'result-1';
          },
        },
        {
          type: 'function',
          name: 'step-2',
          fn: async () => {
            executedSteps.push(2);
            return 'result-2';
          },
        },
      ],
    };

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      startStep: 1,
    });

    expect(result.success).toBe(true);
    expect(executedSteps).toEqual([1, 2]); // Step 0 skipped
    expect(result.finalOutput).toBe('result-2');
  });

  it('starts from beginning when startStep is 0', async () => {
    const agentManager = createMockAgentManager();
    const executedSteps: number[] = [];

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async () => {
            executedSteps.push(0);
            return 'result-0';
          },
        },
        {
          type: 'function',
          name: 'step-1',
          fn: async () => {
            executedSteps.push(1);
            return 'result-1';
          },
        },
      ],
    };

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      startStep: 0,
    });

    expect(result.success).toBe(true);
    expect(executedSteps).toEqual([0, 1]);
  });
});

// -----------------------------------------------------------------------------
// Context Restoration Tests
// -----------------------------------------------------------------------------

describe('executePipelineV2 - Context Restoration', () => {
  it('restores context from restoredContext option', async () => {
    const agentManager = createMockAgentManager();
    let capturedContext: PipelineContext | undefined;

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async () => 'should-be-skipped',
        },
        {
          type: 'function',
          name: 'step-1',
          fn: async (ctx: PipelineContext) => {
            capturedContext = ctx;
            return 'result-1';
          },
        },
      ],
    };

    const restoredContext = createTestContext({
      input: 'restored input',
      outputs: { 'step-0': 'restored-result-0' },
      metadata: { restored: true },
    });

    const result = await executePipelineV2(config, 'ignored input', {
      agentManager,
      startStep: 1,
      restoredContext,
    });

    expect(result.success).toBe(true);
    expect(capturedContext).toBeDefined();
    expect(capturedContext!.input).toBe('restored input');
    expect(capturedContext!.outputs['step-0']).toBe('restored-result-0');
    expect(capturedContext!.metadata.restored).toBe(true);
  });

  it('uses restored input from restoredContext', async () => {
    const agentManager = createMockAgentManager();
    let capturedInput: string | undefined;

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async (ctx: PipelineContext) => {
            capturedInput = ctx.input;
            return 'result';
          },
        },
      ],
    };

    const restoredContext = createTestContext({
      input: 'the restored input',
    });

    await executePipelineV2(config, 'new input that should be ignored', {
      agentManager,
      restoredContext,
    });

    expect(capturedInput).toBe('the restored input');
  });

  it('preserves conversationId from options over restoredContext', async () => {
    const agentManager = createMockAgentManager();

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async () => 'result',
        },
      ],
    };

    const restoredContext = createTestContext({
      conversationId: 'old-conversation-id',
    });

    const result = await executePipelineV2(config, 'input', {
      agentManager,
      restoredContext,
      conversationId: 'new-conversation-id',
    });

    expect(result.success).toBe(true);
    expect(result.context.conversationId).toBe('new-conversation-id');
  });

  it('uses restoredContext conversationId when options.conversationId not specified', async () => {
    const agentManager = createMockAgentManager();

    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'step-0',
          fn: async () => 'result',
        },
      ],
    };

    const restoredContext = createTestContext({
      conversationId: 'restored-conversation-id',
    });

    const result = await executePipelineV2(config, 'input', {
      agentManager,
      restoredContext,
    });

    expect(result.success).toBe(true);
    expect(result.context.conversationId).toBe('restored-conversation-id');
  });
});

// -----------------------------------------------------------------------------
// Error Handling with runId
// -----------------------------------------------------------------------------

describe('executePipelineV2 - Error Handling with runId', () => {
  it('includes runId in error result', async () => {
    const agentManager = createMockAgentManager();
    const config: PipelineConfigV2 = {
      id: 'test-pipeline',
      steps: [
        {
          type: 'function',
          name: 'failing-step',
          fn: async () => {
            throw new Error('Step failed');
          },
        },
      ],
    };

    const result = await executePipelineV2(config, 'test input', {
      agentManager,
      runId: 'error-run-id',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.runId).toBe('error-run-id');
  });
});
