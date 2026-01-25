import { Schema } from 'effect';
import { Tool } from './tool';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { getActiveSpan } from '../tracing/context';

/**
 * Handoff result indicating a message should be transferred to another agent
 */
export interface HandoffResult {
  type: 'handoff';
  agentId: string;
  message: string;
  context?: Record<string, any>;
}

/**
 * Create a handoff tool that allows agents to transfer conversations to other agents
 * @param agentManager - Function to get an agent by ID
 * @param availableAgents - Function to get list of available agent IDs
 * @param tracer - Optional tracer for tracing handoff operations
 */
export function createHandoffTool(
  getAgent: (id: string) => any,
  getAvailableAgents: () => string[],
  tracer?: Tracer
): Tool {
  return {
    id: 'handoff_to_agent',
    name: 'handoff_to_agent',
    description: 'Transfer the conversation to another agent. Use this when the current agent cannot handle the request and another agent would be better suited.',
    schema: {
      input: Schema.Struct({
        agentId: Schema.String,
        message: Schema.optional(Schema.String),
        context: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      }),
      success: Schema.Struct({
        type: Schema.Literal('handoff'),
        agentId: Schema.String,
        message: Schema.String,
        context: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      }),
      metadata: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The ID of the agent to transfer the conversation to',
          },
          message: {
            type: 'string',
            description: 'The message to send to the target agent. If not provided, the original user message will be used.',
          },
          context: {
            type: 'object',
            description: 'Optional context to pass to the target agent',
          },
        },
        required: ['agentId'],
      },
    },
    execute: async (args) => {
      const { agentId, message, context } = args;

      // Create span for handoff tool execution
      const handoffSpan = tracer?.startSpan('tool.handoff', {
        kind: SpanKind.INTERNAL,
        attributes: {
          'tool.id': 'handoff_to_agent',
          'handoff.targetAgent': agentId,
          'handoff.hasMessage': message !== undefined && message !== '',
          'handoff.hasContext': context !== undefined,
        },
      });

      const previousActiveSpan = tracer?.getActiveSpan();
      if (handoffSpan) {
        tracer?.setActiveSpan(handoffSpan);
      }

      try {
        // Validate agent exists
        const agent = getAgent(agentId);
        if (!agent) {
          const availableAgents = getAvailableAgents();
          const error = new Error(
            `Agent "${agentId}" not found. Available agents: ${availableAgents.join(', ') || 'none'}`
          );
          if (handoffSpan) {
            handoffSpan.recordException(error);
            handoffSpan.setStatus('error', error.message);
          }
          throw error;
        }

        // Return handoff result (will be processed by the message pipeline)
        const handoffResult: HandoffResult = {
          type: 'handoff',
          agentId,
          message: message || '', // Will be replaced with original message if not provided
          context,
        };

        if (handoffSpan) {
          handoffSpan.setStatus('ok');
        }

        return handoffResult;
      } finally {
        if (handoffSpan) {
          handoffSpan.end();
          // Restore previous active span
          if (previousActiveSpan) {
            tracer?.setActiveSpan(previousActiveSpan);
          } else {
            tracer?.setActiveSpan(undefined);
          }
        }
      }
    },
  };
}
