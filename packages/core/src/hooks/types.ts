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
  // Policy decision hooks
  | 'afterPolicyDecision'
  // Response generation hooks
  | 'beforeResponseGenerated'
  | 'afterResponseGenerated'
  // Context hooks
  | 'beforeContextInserted'
  | 'afterContextInserted'
  // Routing hooks
  | 'beforeRouting'
  | 'afterRouting'
  | 'afterRoutingDecision' // Emitted only when routing concerns are detected
  // Pipeline-specific hooks
  | 'beforePipeline' // Before pipeline execution starts
  | 'afterPipeline' // After pipeline completes successfully
  | 'beforeStep' // Before each step executes
  | 'afterStep' // After each step completes
  | 'onStepError' // When a step fails (before retry)
  | 'onPipelineError'; // When pipeline fails (after all retries exhausted)

/**
 * Hook correlation context with export capabilities
 */
export interface HookCorrelationContext {
  /** Unique identifier for this run */
  runId?: string;
  /** Conversation identifier */
  conversationId?: string;
  /** Intent identifier */
  intentId?: string;
  /** Agent identifier */
  agentId?: string;
  /** ISO 8601 timestamp when event occurred */
  timestamp?: string;
  /** OpenTelemetry trace ID */
  traceId?: string;
  /** OpenTelemetry span ID */
  spanId?: string;
  /** OpenTelemetry parent span ID */
  parentSpanId?: string;
  /** Pipeline identifier (for pipeline runs) */
  pipelineId?: string;
  /** Step name (for pipeline steps) */
  stepName?: string;
  /** Export trace function (available when observability is enabled) */
  exportTrace?: (traceId?: string) => Promise<any>;
}

/**
 * Hook event data structure
 */
export interface HookEvent {
  type: HookType;
  data: any;
  conversationId?: string;
  metadata?: Record<string, any>;
  /** Unique identifier for this run */
  runId?: string;
  /** Intent identifier */
  intentId?: string;
  /** Agent identifier */
  agentId?: string;
  /** ISO 8601 timestamp when event occurred */
  timestamp?: string;
  /** OpenTelemetry trace ID */
  traceId?: string;
  /** OpenTelemetry span ID */
  spanId?: string;
  /** OpenTelemetry parent span ID */
  parentSpanId?: string;
  /** Pipeline identifier (for pipeline runs) */
  pipelineId?: string;
  /** Step name (for pipeline steps) */
  stepName?: string;
  /** Correlation context with export capabilities */
  correlation?: HookCorrelationContext;
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
