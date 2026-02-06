// Export all types and classes
export * from './intent/intent';
export * from './agent/agent';
// Note: MCPClientMetrics can be imported directly from './agent/factory' if needed
export * from './tool/tool';
export type { EffectProviderFactory } from './platform/base';
export * from './platform/provider';

// Provider pack registry for external provider packages
export {
  registerBuiltinPack,
  getBuiltinPack,
  getBuiltinPackIds,
  isBuiltinPack,
} from './platform/packs';
export * from './config/types';
export { ToolRegistry } from './tool/registry';
export { AgentManager } from './agent/manager';
export { IntentMatcher } from './intent/matcher';
export { IntentRouter } from './intent/router';
export { ContextManager } from './context/manager';
export * from './context/context';
export { SqliteContextStorage } from './context/storage/sqlite';
export { PostgresContextStorage } from './context/storage/postgres';

// Checkpoint storage exports
export {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from './pipeline/checkpoint';
export type {
  CheckpointStorage,
  Checkpoint,
  CheckpointStatus,
  CheckpointManagerOptions,
  CheckpointCleanupOptions,
} from './pipeline/checkpoint';

// Pause types
export type {
  PauseSignal,
  PauseRequest,
  PendingPause,
  PauseMetadata,
  HumanInputResumeOptions,
} from './pipeline/pause/types';
export { createRequestHumanInputTool } from './pipeline/pause';
export { createCalculatorTool } from './tool/calculator';

export { HookManager } from './hooks/manager';
export * from './hooks/types';
export { MessageRouter } from './routing/router';
export * from './routing/types';
export { WorkflowManager } from './workflow/manager';
export { WorkflowContext } from './workflow/context';
export * from './workflow/types';
export * from './tracing';
export { NoOpTracer } from './tracing/noop-tracer';
export { createOpenTelemetryTracer, isOpenTelemetryAvailable } from './tracing/otel-exporter';
export * from './eval/golden-trace';
export * from './eval/artifact';
export * from './eval/normalizer';
export * from './eval/storage';
export * from './eval/service';
export { GoldenTraceRecorder } from './eval/recorder';
export * from './eval/assertions';
export * from './eval/assertion-runner';
export * from './eval/replay';
export * from './eval/mock-tools';
export * from './eval/test-clock';

// Observability exports
export { buildObservabilityLayers, annotateSpan, withFredSpan } from './observability/otel';
export type { ObservabilityLayers } from './observability/otel';
export {
  // FiberRef-based API (preferred)
  CorrelationContextRef,
  getCorrelationContext,
  getSpanIds,
  withCorrelationContext,
  runWithCorrelationBridge,
  // Backward-compatible sync API
  createCorrelationContext,
  getCurrentCorrelationContext,
  getCurrentSpanIds,
  // Legacy (deprecated, delegates to bridge)
  runWithCorrelationContext,
} from './observability/context';
export type { CorrelationContext } from './observability/context';
export { ObservabilityService, ObservabilityServiceLive } from './observability/service';
export type {
  ObservabilityServiceConfig,
  SamplingDecision,
  RunRecord,
  HookEvent,
  StepSpan,
  ToolUsage,
  ModelUsage,
} from './observability/service';

// Stream output utilities
export { streamOutput, streamOutputSimple, StreamOutputError } from './stream/output';
export type { StreamOutputOptions } from './stream/output';

// Global variables
export type { VariableFactory, VariableValue } from './variables';

// Message processing types
export type {
  RouteResult,
  ProcessingOptions,
  MemoryDefaults,
  SemanticMatcherFn,
} from './message-processor/types';

// Intent service wrappers (for Effect-based usage)
export {
  IntentMatcherService,
  IntentMatcherServiceFromInstance,
  IntentRouterService,
  IntentRouterServiceFromInstance,
} from './intent/service';

// Routing service wrapper (for Effect-based usage)
export {
  MessageRouterService,
  MessageRouterServiceFromInstance,
} from './routing/service';

// Utility functions
export { sanitizeError } from './utils/validation';

// Stream event types and OpenAI conversion
export type { StreamEvent } from './stream/events';
export { toOpenAIStream } from './stream/openai';
