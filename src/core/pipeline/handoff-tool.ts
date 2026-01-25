/**
 * Handoff Tool for Agent Execution
 *
 * Provides a tool that agents can call to hand off execution to another agent.
 * The handoff is validated against workflow-declared allowed targets.
 */

import type { Tool } from '../tool/tool';
import type { HandoffContext } from './handoff';
import type { AgentResponse } from '../agent/agent';
import { validateHandoffTarget } from './handoff';

/**
 * Handoff tool configuration
 */
export interface HandoffToolConfig {
  /** Agent ID that will use this tool */
  sourceAgent: string;

  /** Workflow-declared allowed target agents */
  allowedTargets: string[];

  /** Function to execute the actual handoff (provided by executor) */
  executeHandoff: (targetAgent: string, context: HandoffContext) => Promise<AgentResponse>;
}

/**
 * Handoff request signal returned by the tool
 */
export interface HandoffRequest {
  type: 'handoff_request';
  targetAgent: string;
  reason?: string;
}

/**
 * Handoff error signal returned by the tool
 */
export interface HandoffError {
  type: 'handoff_error';
  error: string;
  availableTargets: string[];
}

/**
 * Type guard to check if a value is a HandoffRequest
 */
export function isHandoffRequest(value: unknown): value is HandoffRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj.type === 'handoff_request' &&
    typeof obj.targetAgent === 'string'
  );
}

/**
 * Type guard to check if a value is a HandoffError
 */
export function isHandoffError(value: unknown): value is HandoffError {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj.type === 'handoff_error' &&
    typeof obj.error === 'string' &&
    Array.isArray(obj.availableTargets)
  );
}

/**
 * Create a handoff tool that agents can use to delegate to other agents.
 *
 * The tool validates the target agent against workflow-declared allowed targets
 * and returns a signal that the graph executor uses to perform the actual handoff.
 *
 * @param config - Handoff tool configuration
 * @returns Tool definition compatible with agent binding
 */
export function createHandoffTool(config: HandoffToolConfig): Tool {
  return {
    id: 'handoff',
    name: 'handoff',
    description: 'Hand off this conversation to another agent. Use when the user request is better handled by a different specialist.',
    execute: async (args: { targetAgent: string; reason?: string }): Promise<HandoffRequest | HandoffError> => {
      const { targetAgent, reason } = args;

      // Validate target against allowed targets
      const validation = validateHandoffTarget(
        { targetAgent, reason },
        {
          sourceAgent: config.sourceAgent,
          allowedTargets: config.allowedTargets,
        }
      );

      if (!validation.success) {
        // Return error to source agent (not throw)
        // HandoffResult discriminated union: success=false means error field exists
        const errorMessage = 'error' in validation ? validation.error : 'Invalid handoff target';
        return {
          type: 'handoff_error',
          error: errorMessage,
          availableTargets: config.allowedTargets,
        };
      }

      // Return handoff request signal
      // The graph executor will detect this and perform the actual handoff
      return {
        type: 'handoff_request',
        targetAgent,
        reason,
      };
    },
  };
}
