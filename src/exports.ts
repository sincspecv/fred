// Export all types and classes
export * from './core/intent/intent';
export * from './core/agent/agent';
// Note: MCPClientMetrics can be imported directly from './core/agent/factory' if needed
export * from './core/tool/tool';
export type { EffectProviderFactory } from './core/platform/base';
export * from './core/platform/provider';
export * from './config/types';
export { ToolRegistry } from './core/tool/registry';
export { AgentManager } from './core/agent/manager';
export { IntentMatcher } from './core/intent/matcher';
export { IntentRouter } from './core/intent/router';
export { ContextManager } from './core/context/manager';
export * from './core/context/context';
export { SqliteContextStorage } from './core/context/storage/sqlite';
export { PostgresContextStorage } from './core/context/storage/postgres';

// Checkpoint storage exports
export {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from './core/pipeline/checkpoint';
export type {
  CheckpointStorage,
  Checkpoint,
  CheckpointStatus,
  CheckpointManagerOptions,
  CheckpointCleanupOptions,
} from './core/pipeline/checkpoint';

// Pause types
export type {
  PauseSignal,
  PauseRequest,
  PendingPause,
  PauseMetadata,
  HumanInputResumeOptions,
} from './core/pipeline/pause/types';
export { createRequestHumanInputTool } from './core/pipeline/pause';
export { createCalculatorTool } from './core/tool/calculator';

export { HookManager } from './core/hooks/manager';
export * from './core/hooks/types';
export { MessageRouter } from './core/routing/router';
export * from './core/routing/types';
export { WorkflowManager } from './core/workflow/manager';
export { WorkflowContext } from './core/workflow/context';
export * from './core/workflow/types';
export * from './core/tracing';
export { NoOpTracer } from './core/tracing/noop-tracer';
export { createOpenTelemetryTracer, isOpenTelemetryAvailable } from './core/tracing/otel-exporter';
export * from './core/eval/golden-trace';
export { GoldenTraceRecorder } from './core/eval/recorder';
export * from './core/eval/assertions';
export * from './core/eval/assertion-runner';

// Observability exports
export { buildObservabilityLayers, annotateSpan, withFredSpan } from './core/observability/otel';
export type { ObservabilityLayers } from './core/observability/otel';

// Stream output utilities
export { streamOutput, streamOutputSimple, StreamOutputError } from './core/stream/output';
export type { StreamOutputOptions } from './core/stream/output';

// Global variables
export type { VariableFactory, VariableValue } from './core/variables';

// Message processing types
export type {
  RouteResult,
  ProcessingOptions,
  MemoryDefaults,
  SemanticMatcherFn,
} from './core/message-processor/types';

// Intent service wrappers (for Effect-based usage)
export {
  IntentMatcherService,
  IntentMatcherServiceFromInstance,
  IntentRouterService,
  IntentRouterServiceFromInstance,
} from './core/intent/service';

// Routing service wrapper (for Effect-based usage)
export {
  MessageRouterService,
  MessageRouterServiceFromInstance,
} from './core/routing/service';
