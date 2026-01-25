/**
 * Pipeline Executor
 *
 * Core execution engine for V2 pipelines with:
 * - Sequential step execution
 * - Hook integration (beforePipeline, afterPipeline, beforeStep, afterStep, onStepError)
 * - Retry with exponential backoff
 * - Flow control (abort/skip)
 */

import {
  PipelineStep,
  AgentStep,
  FunctionStep,
  ConditionalStep,
  PipelineRefStep,
  RetryConfig,
} from './steps';
import { PipelineConfigV2 } from './pipeline';
import { PipelineContext, PipelineContextManager, createPipelineContext } from './context';
import { HookManager } from '../hooks/manager';
import { HookEvent, StepHookEventData, PipelineHookEventData } from '../hooks/types';
import { AgentManager } from '../agent/manager';
import { AgentResponse } from '../agent/agent';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import type { CheckpointManager } from './checkpoint/manager';
import { detectPauseSignal, type DetectedPause } from './pause';
import { Effect } from 'effect';
import { annotateSpan } from '../observability/otel';
import { attachErrorToSpan } from '../observability/errors';

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  success: boolean;
  status?: 'completed' | 'failed' | 'paused' | 'aborted';
  context: PipelineContext;
  finalOutput?: unknown;
  error?: Error;
  abortedBy?: string; // Hook that requested abort
  runId?: string; // Run ID for checkpoint tracking
  pauseRequest?: {
    prompt: string;
    choices?: string[];
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Executor options
 */
export interface ExecutorOptions {
  agentManager: AgentManager;
  hookManager?: HookManager;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (msg: string) => Promise<AgentResponse> } | undefined;
  };
  checkpointManager?: CheckpointManager;
}

/**
 * Extended execution options for resume support.
 */
export interface ExtendedExecutionOptions extends ExecutorOptions {
  conversationId?: string;
  history?: Array<{ role: string; content: string }>;
  runId?: string;                  // Custom run ID (auto-generated if not provided)
  startStep?: number;              // Start from specific step (for resume)
  restoredContext?: PipelineContext; // Restored context from checkpoint
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a single step with retry logic.
 */
async function executeStepWithRetry(
  step: PipelineStep,
  context: PipelineContext,
  options: ExecutorOptions,
  retryCount: number = 0
): Promise<unknown> {
  const { agentManager, pipelineManager } = options;

  switch (step.type) {
    case 'agent': {
      const agent = agentManager.getAgent(step.agentId);
      if (!agent) {
        throw new Error(`Agent "${step.agentId}" not found`);
      }
      const response = await agent.processMessage(context.input, context.history);
      return response;
    }

    case 'function': {
      const result = await step.fn(context);
      return result;
    }

    case 'conditional': {
      const conditionResult = await step.condition(context);
      const stepsToRun = conditionResult ? step.whenTrue : step.whenFalse;
      if (!stepsToRun || stepsToRun.length === 0) {
        return { conditionResult, skipped: true };
      }
      // Execute nested steps in sequence
      let nestedResult: unknown;
      for (const nestedStep of stepsToRun) {
        nestedResult = await executeStepWithRetry(nestedStep, context, options, 0);
      }
      return { conditionResult, result: nestedResult };
    }

    case 'pipeline': {
      if (!pipelineManager) {
        throw new Error('Pipeline manager required for nested pipeline steps');
      }
      const nestedPipeline = pipelineManager.getPipeline(step.pipelineId);
      if (!nestedPipeline) {
        throw new Error(`Nested pipeline "${step.pipelineId}" not found`);
      }
      const response = await nestedPipeline.execute(context.input);
      return response;
    }

    default:
      throw new Error(`Unknown step type: ${(step as any).type}`);
  }
}

/**
 * Execute step with retry and hook integration.
 */
async function executeStepWithHooks(
  step: PipelineStep,
  stepIndex: number,
  contextManager: PipelineContextManager,
  config: PipelineConfigV2,
  options: ExecutorOptions,
  runId?: string
): Promise<{ result: unknown; skipped: boolean; aborted: boolean; abortReason?: string; paused?: DetectedPause }> {
  const { hookManager, tracer } = options;
  const context = contextManager.getStepContext(step.contextView);

  // Create step event data
  const stepData: StepHookEventData = {
    pipelineId: config.id,
    input: context.input,
    context,
    step: {
      name: step.name,
      type: step.type,
      index: stepIndex,
    },
  };

  // Execute beforeStep hooks
  if (hookManager) {
    const beforeEvent: HookEvent = { type: 'beforeStep', data: stepData };
    const beforeResult = await hookManager.executeHooksAndMerge('beforeStep', beforeEvent);

    if (beforeResult.metadata) {
      contextManager.mergeMetadata(beforeResult.metadata);
    }

    // Check for skip
    if (beforeResult.skip) {
      return { result: undefined, skipped: true, aborted: false };
    }

    // Check for abort
    if ((beforeResult as any).abort) {
      return { result: undefined, skipped: false, aborted: true, abortReason: 'beforeStep hook' };
    }
  }

  // Execute pipeline-specific hooks if defined
  if (config.hooks?.beforeStep) {
    for (const handler of config.hooks.beforeStep) {
      const result = await handler({ type: 'beforeStep', data: stepData });
      if (result?.skip) {
        return { result: undefined, skipped: true, aborted: false };
      }
      if ((result as any)?.abort) {
        return { result: undefined, skipped: false, aborted: true, abortReason: 'pipeline beforeStep hook' };
      }
    }
  }

  // Create tracing span
  const stepSpan = tracer?.startSpan(`pipeline.step.${step.name}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'step.name': step.name,
      'step.type': step.type,
      'step.index': stepIndex,
      'pipeline.id': config.id,
    },
  });

  // Annotate span with Fred identifiers using Effect
  const spanAnnotation = annotateSpan({
    runId,
    conversationId: context.conversationId,
    workflowId: context.metadata.workflowId as string | undefined,
    stepName: step.name,
  });

  // Run annotation effect (fire and forget - best effort)
  Effect.runPromise(spanAnnotation).catch(() => {
    // Annotation failed, continue execution
  });

  let result: unknown;
  let lastError: Error | undefined;
  const maxRetries = step.retry?.maxRetries ?? 0;
  const backoffMs = step.retry?.backoffMs ?? 100;
  const maxBackoffMs = step.retry?.maxBackoffMs ?? 10000;

  // Execute with retry
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Annotate retry attempt if > 0
    if (attempt > 0) {
      const retryAnnotation = annotateSpan({ attempt });
      Effect.runPromise(retryAnnotation).catch(() => {});
      stepSpan?.addEvent(`retry.attempt.${attempt}`, {
        'retry.attempt': attempt,
        'retry.maxRetries': maxRetries,
      });
    }

    try {
      result = await executeStepWithRetry(step, context, options, attempt);
      lastError = undefined;
      if (attempt > 0) {
        stepSpan?.addEvent('retry.success', { 'retry.attempt': attempt });
      }
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt > 0) {
        stepSpan?.addEvent('retry.error', {
          'retry.attempt': attempt,
          'error.message': lastError.message,
        });
      }

      // Attach error to span with classification
      if (stepSpan) {
        attachErrorToSpan(stepSpan, lastError, {
          includeStack: false, // Stack only in logs, not span
        });
      }

      // Fire onStepError hook
      if (hookManager) {
        const errorData: StepHookEventData = {
          ...stepData,
          error: lastError,
          retryCount: attempt,
        };
        const errorEvent: HookEvent = { type: 'onStepError', data: errorData };
        const errorResult = await hookManager.executeHooksAndMerge('onStepError', errorEvent);

        if ((errorResult as any).abort) {
          if (stepSpan) {
            stepSpan.end();
          }
          return { result: undefined, skipped: false, aborted: true, abortReason: 'onStepError hook' };
        }
      }

      // Fire pipeline-specific onStepError hooks
      if (config.hooks?.onStepError) {
        for (const handler of config.hooks.onStepError) {
          const hookResult = await handler({
            type: 'onStepError',
            data: { ...stepData, error: lastError, retryCount: attempt },
          });
          if ((hookResult as any)?.abort) {
            if (stepSpan) {
              stepSpan.end();
            }
            return { result: undefined, skipped: false, aborted: true, abortReason: 'pipeline onStepError hook' };
          }
        }
      }

      if (attempt < maxRetries) {
        // Calculate backoff with exponential growth
        const delay = Math.min(backoffMs * Math.pow(2, attempt), maxBackoffMs);
        await sleep(delay);
      }
    }
  }

  // If all retries failed
  if (lastError) {
    if (stepSpan) {
      attachErrorToSpan(stepSpan, lastError, {
        includeStack: false, // Stack only in logs, not span
      });
      stepSpan.end();
    }
    throw lastError;
  }

  // Check for pause signal BEFORE recording output
  const pauseDetected = detectPauseSignal(result);
  if (pauseDetected) {
    // Do NOT record step output - step didn't complete normally
    stepSpan?.setStatus('ok');
    stepSpan?.end();
    return { result, skipped: false, aborted: false, paused: pauseDetected };
  }

  // Record step output
  contextManager.recordStepOutput(step.name, result);

  // Execute afterStep hooks
  if (hookManager) {
    const afterData: StepHookEventData = { ...stepData, result };
    const afterEvent: HookEvent = { type: 'afterStep', data: afterData };
    const afterResult = await hookManager.executeHooksAndMerge('afterStep', afterEvent);

    if (afterResult.metadata) {
      contextManager.mergeMetadata(afterResult.metadata);
    }

    if ((afterResult as any).abort) {
      stepSpan?.setStatus('ok');
      stepSpan?.end();
      return { result, skipped: false, aborted: true, abortReason: 'afterStep hook' };
    }
  }

  // Fire pipeline-specific afterStep hooks
  if (config.hooks?.afterStep) {
    for (const handler of config.hooks.afterStep) {
      const handlerResult = await handler({
        type: 'afterStep',
        data: { ...stepData, result },
      });
      if ((handlerResult as any)?.abort) {
        stepSpan?.setStatus('ok');
        stepSpan?.end();
        return { result, skipped: false, aborted: true, abortReason: 'pipeline afterStep hook' };
      }
    }
  }

  stepSpan?.setStatus('ok');
  stepSpan?.end();

  return { result, skipped: false, aborted: false };
}

/**
 * Execute a V2 pipeline.
 */
export async function executePipelineV2(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions
): Promise<PipelineResult> {
  const { hookManager, tracer, checkpointManager } = options;

  // Generate or use provided run ID
  const runId = options.runId ?? checkpointManager?.generateRunId() ?? crypto.randomUUID();

  // Determine start step (default: 0)
  const startStep = options.startStep ?? 0;

  // Determine if checkpointing is enabled
  const checkpointEnabled = config.checkpoint?.enabled !== false && checkpointManager !== undefined;
  const checkpointTtlMs = config.checkpoint?.ttlMs;

  // Create context manager - restore from checkpoint if provided
  let contextManager: PipelineContextManager;
  if (options.restoredContext) {
    // Restore from checkpoint - use restored outputs and metadata
    contextManager = createPipelineContext({
      pipelineId: config.id,
      input: options.restoredContext.input,
      history: options.restoredContext.history,
      conversationId: options.conversationId ?? options.restoredContext.conversationId,
    });
    // Restore accumulated outputs
    for (const [stepName, output] of Object.entries(options.restoredContext.outputs)) {
      contextManager.recordStepOutput(stepName, output);
    }
    // Restore metadata
    contextManager.mergeMetadata(options.restoredContext.metadata);
  } else {
    // Fresh execution
    contextManager = createPipelineContext({
      pipelineId: config.id,
      input,
      history: options.history as any,
      conversationId: options.conversationId,
    });
  }

  // Create tracing span
  const pipelineSpan = tracer?.startSpan(`pipeline.execute.${config.id}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'pipeline.id': config.id,
      'pipeline.stepCount': config.steps.length,
      'input.length': input.length,
    },
  });

  // Annotate pipeline span with Fred identifiers
  const pipelineAnnotation = annotateSpan({
    runId,
    conversationId: options.conversationId,
    workflowId: contextManager.getFullContext().metadata.workflowId as string | undefined,
  });

  // Run annotation effect (fire and forget - best effort)
  Effect.runPromise(pipelineAnnotation).catch(() => {
    // Annotation failed, continue execution
  });

  const pipelineData: PipelineHookEventData = {
    pipelineId: config.id,
    input,
    context: contextManager.getFullContext(),
  };

  try {
    // Execute beforePipeline hooks
    if (hookManager) {
      const beforeEvent: HookEvent = { type: 'beforePipeline', data: pipelineData };
      const beforeResult = await hookManager.executeHooksAndMerge('beforePipeline', beforeEvent);

      if (beforeResult.metadata) {
        contextManager.mergeMetadata(beforeResult.metadata);
      }

      if ((beforeResult as any).abort) {
        pipelineSpan?.setStatus('ok');
        pipelineSpan?.end();
        return {
          success: false,
          status: 'aborted',
          context: contextManager.getFullContext(),
          abortedBy: 'beforePipeline hook',
          runId,
        };
      }
    }

    // Fire pipeline-specific beforePipeline hooks
    if (config.hooks?.beforePipeline) {
      for (const handler of config.hooks.beforePipeline) {
        const result = await handler({ type: 'beforePipeline', data: pipelineData });
        if ((result as any)?.abort) {
          pipelineSpan?.setStatus('ok');
          pipelineSpan?.end();
          return {
            success: false,
            status: 'aborted',
            context: contextManager.getFullContext(),
            abortedBy: 'pipeline beforePipeline hook',
            runId,
          };
        }
      }
    }

    // Execute steps in sequence
    let finalOutput: unknown;
    for (let i = 0; i < config.steps.length; i++) {
      // Skip steps before startStep (for resume)
      if (i < startStep) {
        continue;
      }

      const step = config.steps[i];
      const { result, skipped, aborted, abortReason, paused } = await executeStepWithHooks(
        step,
        i,
        contextManager,
        config,
        options,
        runId
      );

      if (aborted) {
        pipelineSpan?.setStatus('ok');
        pipelineSpan?.end();
        return {
          success: false,
          status: 'aborted',
          context: contextManager.getFullContext(),
          abortedBy: abortReason,
          runId,
        };
      }

      if (paused) {
        // Create checkpoint with paused status
        if (checkpointManager) {
          try {
            await checkpointManager.saveCheckpoint({
              runId,
              pipelineId: config.id,
              step: i,
              stepName: step.name,
              status: 'paused',
              context: contextManager.getFullContext(),
              expiresAt: paused.ttlMs
                ? new Date(Date.now() + paused.ttlMs)
                : undefined,
              pauseMetadata: paused.metadata,
            });
          } catch (err) {
            console.warn(`[Checkpoint] Failed to save pause checkpoint:`, err);
          }
        }

        // Return immediately with paused status
        pipelineSpan?.setStatus('ok');
        pipelineSpan?.end();
        return {
          success: false,
          status: 'paused',
          context: contextManager.getFullContext(),
          runId,
          pauseRequest: {
            prompt: paused.signal.prompt,
            choices: paused.signal.choices,
            schema: paused.signal.schema,
            metadata: paused.signal.metadata,
          },
        };
      }

      if (!skipped) {
        finalOutput = result;
      }

      // Checkpoint after successful step (best-effort)
      if (checkpointEnabled && !skipped && !aborted) {
        try {
          await checkpointManager!.saveCheckpoint({
            runId,
            pipelineId: config.id,
            step: i,
            stepName: step.name,
            status: 'in_progress',
            context: contextManager.getFullContext(),
            expiresAt: checkpointTtlMs
              ? new Date(Date.now() + checkpointTtlMs)
              : undefined,
          });
        } catch (err) {
          // Best-effort: warn but don't fail pipeline
          console.warn(`[Checkpoint] Failed to save checkpoint for run ${runId} at step ${i}:`, err);
        }
      }
    }

    // Execute afterPipeline hooks
    if (hookManager) {
      const afterData = { ...pipelineData, context: contextManager.getFullContext() };
      const afterEvent: HookEvent = { type: 'afterPipeline', data: afterData };
      await hookManager.executeHooksAndMerge('afterPipeline', afterEvent);
    }

    // Fire pipeline-specific afterPipeline hooks
    if (config.hooks?.afterPipeline) {
      for (const handler of config.hooks.afterPipeline) {
        await handler({
          type: 'afterPipeline',
          data: { ...pipelineData, context: contextManager.getFullContext() },
        });
      }
    }

    pipelineSpan?.setStatus('ok');
    pipelineSpan?.end();

    return {
      success: true,
      status: 'completed',
      context: contextManager.getFullContext(),
      finalOutput,
      runId,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Fire onPipelineError hooks
    if (hookManager) {
      const errorEvent: HookEvent = {
        type: 'onPipelineError',
        data: { ...pipelineData, error: err },
      };
      await hookManager.executeHooks('onPipelineError', errorEvent);
    }

    if (pipelineSpan) {
      attachErrorToSpan(pipelineSpan, err, {
        includeStack: false, // Stack only in logs, not span
      });
      pipelineSpan.end();
    }

    if (config.failFast !== false) {
      return {
        success: false,
        status: 'failed',
        context: contextManager.getFullContext(),
        error: err,
        runId,
      };
    }

    // Continue on error (failFast: false)
    return {
      success: false,
      status: 'failed',
      context: contextManager.getFullContext(),
      error: err,
      runId,
    };
  }
}
