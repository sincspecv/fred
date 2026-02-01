/**
 * Request Human Input Tool
 *
 * A tool that agents can invoke to pause workflow execution
 * and request human input before continuing.
 */

import * as Schema from 'effect/Schema';
import type { Tool } from '../../tool/tool';
import type { PauseSignal, ResumeBehavior } from './types';

/**
 * Input schema for request_human_input tool.
 */
const RequestHumanInputInput = Schema.Struct({
  prompt: Schema.String.annotations({
    description: 'Human-readable prompt explaining what input is needed',
  }),
  choices: Schema.optional(
    Schema.Array(Schema.String).annotations({
      description: 'Optional list of choices for selection-based input',
    })
  ),
  schema: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
      description: 'Optional JSON Schema for structured input validation',
    })
  ),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
      description: 'Optional metadata for UI rendering hints',
    })
  ),
  resumeBehavior: Schema.optional(
    Schema.Literal('rerun', 'continue').annotations({
      description: "Resume behavior: 'rerun' to re-execute step with input, 'continue' to proceed to next step",
    })
  ),
  ttlMs: Schema.optional(
    Schema.Number.annotations({
      description: 'Optional TTL override in milliseconds',
    })
  ),
});

/**
 * Output schema - returns a PauseSignal.
 */
const RequestHumanInputOutput = Schema.Struct({
  __pause: Schema.Literal(true),
  prompt: Schema.String,
  choices: Schema.optional(Schema.Array(Schema.String)),
  schema: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  resumeBehavior: Schema.optional(Schema.Literal('rerun', 'continue')),
  ttlMs: Schema.optional(Schema.Number),
});

/**
 * Create the request_human_input tool.
 *
 * When an agent invokes this tool, it returns a PauseSignal that the
 * executor detects to trigger a pause checkpoint.
 *
 * @returns Tool definition for request_human_input
 *
 * @example
 * // Agent invokes tool:
 * // "I need to ask the user for approval before proceeding"
 * // -> calls request_human_input with prompt="Approve the purchase of $500?"
 * // -> returns { __pause: true, prompt: "...", ... }
 * // -> executor detects pause signal and creates checkpoint
 */
export function createRequestHumanInputTool(): Tool {
  return {
    id: 'request_human_input',
    name: 'request_human_input',
    description:
      'Pause workflow execution and request human input before continuing. ' +
      'Use this when you need approval, a choice selection, or additional information from the user.',
    schema: {
      input: RequestHumanInputInput as any,
      success: RequestHumanInputOutput as any,
      metadata: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Human-readable prompt explaining what input is needed',
          },
          choices: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of choices for selection-based input',
          },
          schema: {
            type: 'object',
            description: 'Optional JSON Schema for structured input validation',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata for UI rendering hints',
          },
          resumeBehavior: {
            type: 'string',
            enum: ['rerun', 'continue'],
            description: "Resume behavior: 'rerun' to re-execute step with input, 'continue' to proceed to next step",
          },
          ttlMs: {
            type: 'number',
            description: 'Optional TTL override in milliseconds',
          },
        },
        required: ['prompt'],
      },
    },
    execute: async (args: any): Promise<PauseSignal> => {
      const { prompt, choices, schema, metadata, resumeBehavior, ttlMs } = args;

      // Return pause signal - executor will detect and handle
      return {
        __pause: true,
        prompt,
        choices: choices ? [...choices] : undefined,
        schema,
        metadata,
        resumeBehavior: resumeBehavior as ResumeBehavior | undefined,
        ttlMs,
      };
    },
  };
}
