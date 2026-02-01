/**
 * Pause Types for Human-in-the-Loop Workflows
 *
 * Defines the shape of pause signals, requests, and pending pause queries.
 */

/**
 * Resume behavior after human input is provided.
 * - 'rerun': Re-execute the step that triggered the pause with human input in context
 * - 'continue': Skip to the next step after the pause point
 */
export type ResumeBehavior = 'rerun' | 'continue';

/**
 * Pause signal returned by request_human_input tool or function step.
 * Detected by executor to trigger pause checkpoint.
 */
export interface PauseSignal {
  /** Marker for tool-based pause signals */
  __pause: true;
  /** Human-readable prompt for the input request */
  prompt: string;
  /** Optional choices for selection-based input */
  choices?: string[];
  /** Optional JSON Schema for structured input validation */
  schema?: Record<string, unknown>;
  /** Arbitrary metadata for UI rendering hints */
  metadata?: Record<string, unknown>;
  /** Resume behavior after input (default: 'continue') */
  resumeBehavior?: ResumeBehavior;
  /** Optional TTL override in milliseconds */
  ttlMs?: number;
}

/**
 * Return-value pause request from function steps.
 * Alternative to tool-based PauseSignal using { pause: true, ... } convention.
 */
export interface PauseRequest {
  /** Marker for return-value pause */
  pause: true;
  /** Human-readable prompt */
  prompt: string;
  /** Optional choices */
  choices?: string[];
  /** Optional JSON Schema */
  schema?: Record<string, unknown>;
  /** UI/rendering metadata */
  metadata?: Record<string, unknown>;
  /** Resume behavior (default: 'continue') */
  resumeBehavior?: ResumeBehavior;
  /** TTL override in milliseconds */
  ttlMs?: number;
}

/**
 * Pause metadata stored in checkpoint.
 * Normalized from either PauseSignal or PauseRequest.
 */
export interface PauseMetadata {
  /** Human-readable prompt */
  prompt: string;
  /** Optional choices */
  choices?: string[];
  /** Optional JSON Schema */
  schema?: Record<string, unknown>;
  /** UI/rendering metadata */
  metadata?: Record<string, unknown>;
  /** Resume behavior */
  resumeBehavior: ResumeBehavior;
}

/**
 * Pending pause information returned by query APIs.
 */
export interface PendingPause {
  /** Run identifier */
  runId: string;
  /** Pipeline identifier */
  pipelineId: string;
  /** Step that triggered the pause */
  stepName: string;
  /** Human-readable prompt */
  prompt: string;
  /** Optional choices */
  choices?: string[];
  /** Optional JSON Schema */
  schema?: Record<string, unknown>;
  /** UI/rendering metadata */
  metadata?: Record<string, unknown>;
  /** When pause was created */
  createdAt: Date;
  /** When pause expires (if TTL set) */
  expiresAt?: Date;
}

/**
 * Options for resuming a paused pipeline with human input.
 */
export interface HumanInputResumeOptions {
  /** Human-provided input (string for text, or structured data) */
  humanInput: string;
  /** Optional override of resume behavior */
  resumeBehavior?: ResumeBehavior;
  /** Optional conversation ID for context management */
  conversationId?: string;
}

/**
 * Type guard: Check if value is a tool-based PauseSignal.
 */
export function isPauseSignal(value: unknown): value is PauseSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__pause' in value &&
    (value as PauseSignal).__pause === true &&
    'prompt' in value &&
    typeof (value as PauseSignal).prompt === 'string'
  );
}

/**
 * Type guard: Check if value is a return-value PauseRequest.
 */
export function isPauseRequest(value: unknown): value is PauseRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pause' in value &&
    (value as PauseRequest).pause === true &&
    'prompt' in value &&
    typeof (value as PauseRequest).prompt === 'string'
  );
}

/**
 * Normalize PauseSignal or PauseRequest to PauseMetadata for storage.
 */
export function toPauseMetadata(signal: PauseSignal | PauseRequest): PauseMetadata {
  return {
    prompt: signal.prompt,
    choices: signal.choices,
    schema: signal.schema,
    metadata: signal.metadata,
    resumeBehavior: signal.resumeBehavior ?? 'continue',
  };
}
