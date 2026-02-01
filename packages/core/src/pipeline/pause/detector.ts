/**
 * Pause Signal Detector
 *
 * Detects pause signals from pipeline step execution results.
 * Supports both tool-based signals (PauseSignal with __pause: true)
 * and return-value signals (PauseRequest with pause: true).
 */

import {
  PauseSignal,
  PauseRequest,
  isPauseSignal,
  isPauseRequest,
  toPauseMetadata,
  type PauseMetadata,
} from './types';

/**
 * Result of pause detection.
 */
export interface DetectedPause {
  /** The normalized pause signal */
  signal: PauseSignal;
  /** Pause metadata for checkpoint storage */
  metadata: PauseMetadata;
  /** TTL override if specified */
  ttlMs?: number;
}

/**
 * Detect pause signal from step execution result.
 *
 * Checks for both tool-based PauseSignal (with __pause: true marker)
 * and return-value PauseRequest (with pause: true marker).
 *
 * For agent steps, the result may contain tool call results.
 * We need to check if any tool result is a pause signal.
 *
 * @param result - Step execution result (could be any shape)
 * @returns DetectedPause if pause signal found, null otherwise
 *
 * @example
 * // Tool-based pause (from request_human_input tool)
 * const result = { __pause: true, prompt: 'Approve?' };
 * detectPauseSignal(result); // => { signal: {...}, metadata: {...} }
 *
 * // Return-value pause (from function step)
 * const result = { pause: true, prompt: 'Select option' };
 * detectPauseSignal(result); // => { signal: {...}, metadata: {...} }
 *
 * // Normal result (no pause)
 * const result = { data: 'processed' };
 * detectPauseSignal(result); // => null
 */
export function detectPauseSignal(result: unknown): DetectedPause | null {
  // Direct PauseSignal check (tool-based)
  if (isPauseSignal(result)) {
    return {
      signal: result,
      metadata: toPauseMetadata(result),
      ttlMs: result.ttlMs,
    };
  }

  // Direct PauseRequest check (return-value based)
  if (isPauseRequest(result)) {
    const signal = convertPauseRequestToSignal(result);
    return {
      signal,
      metadata: toPauseMetadata(result),
      ttlMs: result.ttlMs,
    };
  }

  // Check for agent response with tool calls
  // Tool results might contain pause signals
  if (isAgentResponseLike(result)) {
    const toolCalls = result.toolCalls;
    if (toolCalls && Array.isArray(toolCalls)) {
      for (const toolCall of toolCalls) {
        // Check if tool result is a pause signal
        if (toolCall.result && isPauseSignal(toolCall.result)) {
          return {
            signal: toolCall.result,
            metadata: toPauseMetadata(toolCall.result),
            ttlMs: toolCall.result.ttlMs,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Convert PauseRequest to PauseSignal format.
 */
function convertPauseRequestToSignal(request: PauseRequest): PauseSignal {
  return {
    __pause: true,
    prompt: request.prompt,
    choices: request.choices,
    schema: request.schema,
    metadata: request.metadata,
    resumeBehavior: request.resumeBehavior,
    ttlMs: request.ttlMs,
  };
}

/**
 * Type guard for agent response-like objects.
 */
function isAgentResponseLike(value: unknown): value is {
  toolCalls?: Array<{ result?: unknown }>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('toolCalls' in value || 'content' in value)
  );
}
