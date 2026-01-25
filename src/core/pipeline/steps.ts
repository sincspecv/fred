/**
 * Pipeline Step Types
 *
 * Discriminated union of step types for sequential pipeline execution.
 * Each step type has a `type` discriminant and a required `name` field for observability.
 */

// Import full PipelineContext from context module
import type { PipelineContext } from './context';

// Re-export for backward compatibility
export type { PipelineContext } from './context';

/**
 * Retry configuration for steps
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial backoff in milliseconds */
  backoffMs: number;
  /** Optional maximum backoff cap in milliseconds */
  maxBackoffMs?: number;
}

/**
 * Base step interface - common fields for all step types
 */
export interface BaseStep {
  /** Step name for observability and output keying (required) */
  name: string;
  /** Optional retry configuration */
  retry?: RetryConfig;
  /** Context visibility for this step (default: 'accumulated') */
  contextView?: 'accumulated' | 'isolated';
}

/**
 * Agent step - executes a registered agent
 */
export interface AgentStep extends BaseStep {
  /** Discriminant for agent steps */
  type: 'agent';
  /** ID of the registered agent to execute */
  agentId: string;
}

/**
 * Function step - executes a custom function
 */
export interface FunctionStep extends BaseStep {
  /** Discriminant for function steps */
  type: 'function';
  /** Function to execute with pipeline context */
  fn: (context: PipelineContext) => Promise<unknown> | unknown;
}

/**
 * Conditional step - branches based on condition evaluation
 */
export interface ConditionalStep extends BaseStep {
  /** Discriminant for conditional steps */
  type: 'conditional';
  /** Condition function to evaluate */
  condition: (context: PipelineContext) => boolean | Promise<boolean>;
  /** Steps to execute when condition is true */
  whenTrue: PipelineStep[];
  /** Optional steps to execute when condition is false */
  whenFalse?: PipelineStep[];
}

/**
 * Pipeline reference step - executes another registered pipeline
 */
export interface PipelineRefStep extends BaseStep {
  /** Discriminant for pipeline reference steps */
  type: 'pipeline';
  /** ID of the registered pipeline to execute */
  pipelineId: string;
}

/**
 * Discriminated union of all pipeline step types
 */
export type PipelineStep = AgentStep | FunctionStep | ConditionalStep | PipelineRefStep;
