import { Schema } from 'effect';
import type { Tool, ToolSchemaDefinition } from './tool';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';

/**
 * Handoff input type
 *
 * Note: context is a JSON string for OpenAI strict-mode compatibility.
 * The execute function will parse it back to an object.
 */
interface HandoffInput {
  agentId: string;
  message?: string;
  context?: string; // JSON-stringified context for OpenAI compatibility
}

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
): Tool<HandoffInput, HandoffResult, never> {
  // Use Schema.String for context to avoid OpenAI strict-mode issues with
  // additionalProperties. The context is JSON-stringified when passed.
  // Schema.Record with Schema.Unknown produces invalid JSON Schema for OpenAI.
  const schema: ToolSchemaDefinition<HandoffInput, HandoffResult, never> = {
    input: Schema.Struct({
      agentId: Schema.String,
      message: Schema.optional(Schema.String),
      context: Schema.optional(Schema.String), // JSON-stringified context
    }) as Schema.Schema<HandoffInput>,
    success: Schema.Struct({
      type: Schema.Literal('handoff'),
      agentId: Schema.String,
      message: Schema.String,
      context: Schema.optional(Schema.String), // JSON-stringified context
    }) as Schema.Schema<HandoffResult>,
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
          type: 'string',
          description: 'Optional JSON-stringified context object to pass to the target agent',
        },
      },
      required: ['agentId'],
    },
  };

  return {
    id: 'handoff_to_agent',
    name: 'handoff_to_agent',
    description: 'Transfer the conversation to another agent. Use this when the current agent cannot handle the request and another agent would be better suited.',
    schema,
    execute: async (args: HandoffInput): Promise<HandoffResult> => {
      const { agentId, message, context: contextStr } = args;
      // Parse JSON context if provided
      let context: Record<string, unknown> | undefined;
      if (contextStr) {
        try {
          context = JSON.parse(contextStr);
        } catch {
          // If parsing fails, wrap the string in an object
          context = { raw: contextStr };
        }
      }

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
