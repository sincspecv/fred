/**
 * Hook types for different pipeline stages
 */
export type HookType =
  // Message lifecycle hooks
  | 'beforeMessageReceived'
  | 'afterMessageReceived'
  // Intent hooks
  | 'beforeIntentDetermined'
  | 'afterIntentDetermined'
  // Agent selection hooks
  | 'beforeAgentSelected'
  | 'afterAgentSelected'
  // Tool execution hooks
  | 'beforeToolCalled'
  | 'afterToolCalled'
  // Response generation hooks
  | 'beforeResponseGenerated'
  | 'afterResponseGenerated'
  // Context hooks
  | 'beforeContextInserted'
  | 'afterContextInserted'
  // Routing hooks
  | 'beforeRouting'
  | 'afterRouting'
  // Pipeline-specific hooks
  | 'beforePipeline' // Before pipeline execution starts
  | 'afterPipeline' // After pipeline completes successfully
  | 'beforeStep' // Before each step executes
  | 'afterStep' // After each step completes
  | 'onStepError' // When a step fails (before retry)
  | 'onPipelineError'; // When pipeline fails (after all retries exhausted)

/**
 * Hook event data structure
 */
export interface HookEvent {
  type: HookType;
  data: any;
  conversationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Hook result that can modify the pipeline
 */
export interface HookResult {
  // Context to inject into the conversation
  context?: Record<string, any>;
  // Modified data (message, intent match, agent, tool call, response, etc.)
  data?: any;
  // Whether to skip the next step
  skip?: boolean;
  // Additional metadata
  metadata?: Record<string, any>;
  // Whether to abort pipeline execution (pipeline hooks only)
  abort?: boolean;
}

/**
 * Hook handler function
 */
export type HookHandler = (event: HookEvent) => Promise<HookResult | void> | HookResult | void;

/**
 * Event data for pipeline hooks (beforePipeline, afterPipeline, onPipelineError)
 */
export interface PipelineHookEventData {
  /** Unique pipeline execution ID */
  pipelineId: string;
  /** Original user input */
  input: string;
  /** Pipeline context (imported in manager) */
  context: unknown;
  /** Final result (only present in afterPipeline) */
  result?: unknown;
  /** Error details (only present in onPipelineError) */
  error?: Error;
}

/**
 * Event data for step hooks (beforeStep, afterStep, onStepError)
 */
export interface StepHookEventData extends PipelineHookEventData {
  /** Step metadata */
  step: {
    /** Step name (unique within pipeline) */
    name: string;
    /** Step type discriminant */
    type: 'agent' | 'function' | 'conditional' | 'pipeline';
    /** Step index in pipeline sequence */
    index: number;
  };
  /** Step result (only present in afterStep) */
  result?: unknown;
  /** Step error (only present in onStepError) */
  error?: Error;
  /** Current retry attempt (0 = first try) */
  retryCount?: number;
}
