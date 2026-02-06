/**
 * Correlation context store for observability.
 *
 * Provides AsyncLocalStorage-backed correlation context that flows across
 * async boundaries, ensuring consistent runId, conversationId, intentId, etc.
 * throughout the execution tree.
 *
 * @module src/core/observability/context
 */

import { AsyncLocalStorage } from 'async_hooks';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

/**
 * Correlation context fields that flow across all spans, logs, and hooks.
 */
export interface CorrelationContext {
  /** Unique identifier for this run */
  runId: string;
  /** Conversation identifier */
  conversationId?: string;
  /** Intent identifier */
  intentId?: string;
  /** Agent identifier */
  agentId?: string;
  /** ISO 8601 timestamp when context was created */
  timestamp: string;
  /** OpenTelemetry trace ID (populated from active span context) */
  traceId?: string;
  /** OpenTelemetry span ID (populated from active span context) */
  spanId?: string;
  /** OpenTelemetry parent span ID (populated from active span context) */
  parentSpanId?: string;
  /** Pipeline identifier (optional, for pipeline runs) */
  pipelineId?: string;
  /** Step name (optional, for pipeline steps) */
  stepName?: string;
}

/**
 * AsyncLocalStorage instance for correlation context.
 */
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a new correlation context with OpenTelemetry span IDs if available.
 *
 * @param options - Context options (runId is required, others optional)
 * @returns Correlation context with span IDs populated from active span
 */
export function createCorrelationContext(options: {
  runId: string;
  conversationId?: string;
  intentId?: string;
  agentId?: string;
  pipelineId?: string;
  stepName?: string;
}): CorrelationContext {
  // Get active span context if available
  const activeContext = context.active();
  const span = trace.getSpan(activeContext);
  const spanContext = span?.spanContext();

  return {
    runId: options.runId,
    conversationId: options.conversationId,
    intentId: options.intentId,
    agentId: options.agentId,
    timestamp: new Date().toISOString(),
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
    parentSpanId: undefined, // Parent span ID not directly available in span context
    pipelineId: options.pipelineId,
    stepName: options.stepName,
  };
}

/**
 * Get the current correlation context.
 *
 * Returns undefined if no context is active (outside of runWithContext).
 */
export function getCurrentCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Run a function with correlation context active.
 *
 * Context is available to all async operations within the function via
 * getCurrentCorrelationContext().
 *
 * @param context - Correlation context to activate
 * @param fn - Function to run with context
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const context = createCorrelationContext({ runId: 'run-123' });
 * await runWithCorrelationContext(context, async () => {
 *   const ctx = getCurrentCorrelationContext();
 *   console.log(ctx?.runId); // 'run-123'
 * });
 * ```
 */
export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return correlationStorage.run(context, async () => fn());
}

/**
 * Get current OpenTelemetry span IDs from active span context.
 *
 * This is called on each log emission to ensure IDs stay accurate
 * even as spans change during execution.
 *
 * @returns Object with traceId, spanId, parentSpanId (if available)
 */
export function getCurrentSpanIds(): {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
} {
  const activeContext = context.active();
  const span = trace.getSpan(activeContext);
  const spanContext = span?.spanContext();

  if (!spanContext) {
    return {};
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    parentSpanId: undefined, // Parent span ID not directly available
  };
}
