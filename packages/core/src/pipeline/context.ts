/**
 * Pipeline Context Manager
 *
 * Manages pipeline execution context with accumulation of step outputs
 * and support for isolated context views.
 */

import type { AgentMessage } from '../agent/agent';

/**
 * Pipeline execution context.
 * Accumulates step outputs and provides context for each step.
 */
export interface PipelineContext {
  /** Original user input message */
  input: string;

  /** Step outputs keyed by step name */
  outputs: Record<string, unknown>;

  /** Conversation history (from thread memory) */
  history: AgentMessage[];

  /** Metadata injected by hooks */
  metadata: Record<string, unknown>;

  /** Pipeline ID */
  pipelineId: string;

  /** Optional conversation/thread ID */
  conversationId?: string;
}

/**
 * Manages pipeline context accumulation and step views.
 */
export class PipelineContextManager {
  private context: PipelineContext;

  constructor(options: {
    pipelineId: string;
    input: string;
    history?: AgentMessage[];
    conversationId?: string;
  }) {
    this.context = {
      pipelineId: options.pipelineId,
      input: options.input,
      outputs: {},
      history: options.history ?? [],
      metadata: {},
      conversationId: options.conversationId,
    };
  }

  /**
   * Get context view for a step.
   * @param view - 'accumulated' (default) or 'isolated'
   */
  getStepContext(view: 'accumulated' | 'isolated' = 'accumulated'): PipelineContext {
    if (view === 'isolated') {
      // Isolated: only input and metadata, no accumulated outputs
      return {
        ...this.context,
        outputs: {},
        history: [],
      };
    }
    // Accumulated: full context with all previous outputs
    return { ...this.context };
  }

  /**
   * Record a step's output.
   * @param stepName - Step name (must be unique)
   * @param output - Step result
   */
  recordStepOutput(stepName: string, output: unknown): void {
    if (stepName in this.context.outputs) {
      console.warn(`Step output for "${stepName}" already exists, overwriting`);
    }
    this.context.outputs[stepName] = output;
  }

  /**
   * Add metadata (typically from hooks).
   */
  addMetadata(key: string, value: unknown): void {
    this.context.metadata[key] = value;
  }

  /**
   * Merge metadata object.
   */
  mergeMetadata(metadata: Record<string, unknown>): void {
    this.context.metadata = { ...this.context.metadata, ...metadata };
  }

  /**
   * Append message to history.
   */
  appendToHistory(message: AgentMessage): void {
    this.context.history.push(message);
  }

  /**
   * Get the full accumulated context (for final result).
   */
  getFullContext(): PipelineContext {
    return { ...this.context };
  }

  /**
   * Get specific step output by name.
   */
  getStepOutput(stepName: string): unknown | undefined {
    return this.context.outputs[stepName];
  }

  /**
   * Check if step has recorded output.
   */
  hasStepOutput(stepName: string): boolean {
    return stepName in this.context.outputs;
  }
}

/**
 * Create a new pipeline context.
 */
export function createPipelineContext(options: {
  pipelineId: string;
  input: string;
  history?: AgentMessage[];
  conversationId?: string;
}): PipelineContextManager {
  return new PipelineContextManager(options);
}
