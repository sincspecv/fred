/**
 * Correlation context store for observability.
 *
 * Provides Effect FiberRef-backed correlation context that flows across
 * Effect fibers, with AsyncLocalStorage bridge for non-Effect consumers.
 *
 * @module src/core/observability/context
 */

import { AsyncLocalStorage } from 'async_hooks';
import { FiberRef, Effect, Option } from 'effect';

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
 * FiberRef instance for correlation context (Effect-based source of truth).
 */
export const CorrelationContextRef = FiberRef.unsafeMake<CorrelationContext | undefined>(undefined);

/**
 * AsyncLocalStorage bridge for non-Effect consumers.
 */
const correlationBridge = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a new correlation context.
 *
 * @param options - Context options (runId is required, others optional)
 * @returns Correlation context object
 */
export function createCorrelationContext(options: {
  runId: string;
  conversationId?: string;
  intentId?: string;
  agentId?: string;
  pipelineId?: string;
  stepName?: string;
}): CorrelationContext {
  return {
    runId: options.runId,
    conversationId: options.conversationId,
    intentId: options.intentId,
    agentId: options.agentId,
    timestamp: new Date().toISOString(),
    traceId: undefined,
    spanId: undefined,
    parentSpanId: undefined,
    pipelineId: options.pipelineId,
    stepName: options.stepName,
  };
}

/**
 * Get correlation context from Effect FiberRef.
 *
 * @returns Effect yielding the current correlation context (or undefined)
 */
export const getCorrelationContext: Effect.Effect<CorrelationContext | undefined> =
  FiberRef.get(CorrelationContextRef);

/**
 * Get the current correlation context (synchronous, backward-compatible).
 *
 * Reads from AsyncLocalStorage bridge for non-Effect consumers.
 * Returns undefined if no context is active.
 */
export function getCurrentCorrelationContext(): CorrelationContext | undefined {
  return correlationBridge.getStore();
}

/**
 * Run an Effect with correlation context active.
 *
 * Sets both FiberRef (Effect source of truth) and AsyncLocalStorage bridge
 * (for non-Effect consumers).
 *
 * @param ctx - Correlation context to activate
 * @returns Effect combinator that wraps execution
 *
 * @example
 * ```typescript
 * const ctx = createCorrelationContext({ runId: 'run-123' });
 * const program = withCorrelationContext(ctx)(
 *   Effect.gen(function* () {
 *     const currentCtx = yield* getCorrelationContext;
 *     console.log(currentCtx?.runId); // 'run-123'
 *   })
 * );
 * await Effect.runPromise(program);
 * ```
 */
export function withCorrelationContext(ctx: CorrelationContext) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    FiberRef.locally(CorrelationContextRef, ctx)(
      Effect.sync(() => correlationBridge.enterWith(ctx)).pipe(
        Effect.flatMap(() => effect)
      )
    );
}

/**
 * Run a Promise-based function with correlation context in AsyncLocalStorage bridge.
 *
 * Use this for Promise-based boundaries (non-Effect code).
 *
 * @param ctx - Correlation context to activate
 * @param fn - Function to run with context
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const ctx = createCorrelationContext({ runId: 'run-123' });
 * await runWithCorrelationBridge(ctx, async () => {
 *   const currentCtx = getCurrentCorrelationContext();
 *   console.log(currentCtx?.runId); // 'run-123'
 * });
 * ```
 */
export function runWithCorrelationBridge<T>(
  ctx: CorrelationContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return correlationBridge.run(ctx, async () => fn());
}

/**
 * Get current OpenTelemetry span IDs from Effect.currentSpan.
 *
 * @returns Effect yielding traceId, spanId, parentSpanId (if available)
 */
export const getSpanIds: Effect.Effect<{ traceId?: string; spanId?: string; parentSpanId?: string }> =
  Effect.currentSpan.pipe(
    Effect.map((span) => ({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: Option.isSome(span.parent) ? (span.parent.value as any).spanId : undefined,
    })),
    Effect.orElseSucceed(() => ({}))
  );

/**
 * Get current OpenTelemetry span IDs (synchronous, backward-compatible).
 *
 * Reads from AsyncLocalStorage bridge context (populated by consumers).
 * Returns empty object if no span context available.
 *
 * @returns Object with traceId, spanId, parentSpanId (if available)
 */
export function getCurrentSpanIds(): {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
} {
  const ctx = correlationBridge.getStore();
  return {
    traceId: ctx?.traceId,
    spanId: ctx?.spanId,
    parentSpanId: ctx?.parentSpanId,
  };
}

/**
 * Run a function with correlation context active.
 *
 * @deprecated Use withCorrelationContext (Effect) or runWithCorrelationBridge (Promise)
 * @param context - Correlation context to activate
 * @param fn - Function to run with context
 * @returns Result of the function
 */
export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return runWithCorrelationBridge(context, fn);
}
