/**
 * Agent Handoff Types and Validation
 *
 * Defines the handoff protocol for agent-to-agent delegation within workflows.
 * Handoffs allow one agent to transfer control to another agent with full context.
 */

import type { AgentMessage } from '../agent/agent';
import type { PipelineContext } from './context';

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
  if (config.allowedTargets.includes(request.targetAgent)) {
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
  // Preserve history based on config (default: true)
  const preserveHistory = config.preserveHistory !== false;

  // Prepare handoff metadata
  const handoffMetadata: Record<string, unknown> = {
    handoffFrom: config.sourceAgent,
    ...(request.reason ? { handoffReason: request.reason } : {}),
    ...(request.metadata ?? {}),
  };

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
