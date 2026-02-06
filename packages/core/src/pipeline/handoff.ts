/**
 * Agent Handoff Types and Validation
 *
 * Defines the handoff protocol for agent-to-agent delegation within workflows.
 * Handoffs allow one agent to transfer control to another agent with full context.
 */

import type { AgentMessage } from '../agent/agent';
import type { PipelineContext } from './context';
import { Effect } from 'effect';
import { getCurrentCorrelationContext, getCurrentSpanIds } from '../observability/context';
import { ObservabilityService } from '../observability/service';

/**
 * Handoff configuration that defines allowed delegation targets.
 * Declared at workflow level to control which agents can handoff to which.
 */
export interface HandoffConfig {
  /** Agent ID initiating the handoff */
  sourceAgent: string;

  /** Workflow-declared allowed target agent IDs */
  allowedTargets: string[];

  /** Whether to transfer full thread history (default: true) */
  preserveHistory?: boolean;
}

/**
 * Handoff request from source agent to target agent.
 */
export interface HandoffRequest {
  /** Requested target agent ID */
  targetAgent: string;

  /** Optional reason for handoff (for observability) */
  reason?: string;

  /** Optional metadata to pass to target agent */
  metadata?: Record<string, unknown>;
}

/**
 * Handoff result - discriminated union for success/failure.
 */
export type HandoffResult =
  | {
      type: 'handoff';
      targetAgent: string;
      success: true;
    }
  | {
      type: 'handoff';
      targetAgent: string;
      success: false;
      error: string;
    };

/**
 * Context prepared for handoff to target agent.
 * Includes full execution state and metadata about the handoff.
 */
export interface HandoffContext {
  /** Original user input */
  input: string;

  /** Full thread history (if preserveHistory enabled) */
  history: AgentMessage[];

  /** Accumulated step outputs from pipeline */
  outputs: Record<string, unknown>;

  /** Metadata including handoff details */
  metadata: Record<string, unknown>;
}

/**
 * Validate handoff target against allowed targets.
 *
 * @param request - Handoff request with target agent
 * @param config - Handoff configuration with allowed targets
 * @returns Success result if target allowed, failure with error otherwise
 */
export function validateHandoffTarget(
  request: HandoffRequest,
  config: HandoffConfig
): HandoffResult {
  // Get correlation context for trace event
  const correlationCtx = getCurrentCorrelationContext();
  const spanIds = getCurrentSpanIds();

  const isAllowed = config.allowedTargets.includes(request.targetAgent);

  // Emit trace event for handoff validation (best-effort)
  const recordValidationEffect = Effect.gen(function* () {
    const service = yield* ObservabilityService;
    yield* service.logStructured({
      level: isAllowed ? 'debug' : 'warning',
      message: isAllowed ? 'Handoff validation passed' : 'Handoff validation failed',
      metadata: {
        handoffFrom: config.sourceAgent,
        handoffTo: request.targetAgent,
        reason: request.reason,
        allowed: isAllowed,
        allowedTargets: config.allowedTargets,
        ...correlationCtx,
        ...spanIds,
      },
    });
  });

  Effect.runPromise(recordValidationEffect).catch(() => {
    // Best-effort: ignore failures
  });

  if (isAllowed) {
    return {
      type: 'handoff',
      targetAgent: request.targetAgent,
      success: true,
    };
  }

  // Target not allowed - return descriptive error with available options
  const availableTargets = config.allowedTargets.join(', ');
  return {
    type: 'handoff',
    targetAgent: request.targetAgent,
    success: false,
    error: `Handoff to '${request.targetAgent}' not allowed. Available: ${availableTargets}`,
  };
}

/**
 * Prepare context for handoff to target agent.
 *
 * Transfers full pipeline context including history, outputs, and metadata.
 * Adds handoff-specific metadata (source agent, reason).
 *
 * @param request - Handoff request with optional reason and metadata
 * @param pipelineContext - Current pipeline execution context
 * @param config - Handoff configuration
 * @returns Context prepared for target agent execution
 */
export function prepareHandoffContext(
  request: HandoffRequest,
  pipelineContext: PipelineContext,
  config: HandoffConfig
): HandoffContext {
  // Get correlation context for trace event
  const correlationCtx = getCurrentCorrelationContext();
  const spanIds = getCurrentSpanIds();

  // Preserve history based on config (default: true)
  const preserveHistory = config.preserveHistory !== false;

  // Calculate handoff depth from chain
  const handoffChain = (pipelineContext.metadata.handoffChain as string[] | undefined) || [];
  const handoffDepth = handoffChain.length;

  // Prepare handoff metadata
  const handoffMetadata: Record<string, unknown> = {
    handoffFrom: config.sourceAgent,
    handoffDepth,
    ...(request.reason ? { handoffReason: request.reason } : {}),
    ...(request.metadata ?? {}),
  };

  // Emit trace event for handoff context preparation (best-effort)
  const recordHandoffEffect = Effect.gen(function* () {
    const service = yield* ObservabilityService;

    // Hash message payload if needed
    const messageHash = pipelineContext.history.length > 0
      ? yield* service.hashPayload(pipelineContext.history)
      : undefined;

    yield* service.logStructured({
      level: 'info',
      message: 'Agent handoff prepared',
      metadata: {
        handoffFrom: config.sourceAgent,
        handoffTo: request.targetAgent,
        handoffReason: request.reason,
        handoffDepth,
        handoffChain,
        historyLength: pipelineContext.history.length,
        messageHash,
        preserveHistory,
        ...correlationCtx,
        ...spanIds,
      },
    });
  });

  Effect.runPromise(recordHandoffEffect).catch(() => {
    // Best-effort: ignore failures
  });

  return {
    input: pipelineContext.input,
    history: preserveHistory ? pipelineContext.history : [],
    outputs: pipelineContext.outputs,
    metadata: {
      ...pipelineContext.metadata,
      ...handoffMetadata,
    },
  };
}

/**
 * Type guard to check if a value is a HandoffResult.
 *
 * @param value - Value to check
 * @returns True if value is HandoffResult
 */
export function isHandoffResult(value: unknown): value is HandoffResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    obj.type === 'handoff' &&
    typeof obj.targetAgent === 'string' &&
    typeof obj.success === 'boolean' &&
    (obj.success === true || (obj.success === false && typeof obj.error === 'string'))
  );
}
