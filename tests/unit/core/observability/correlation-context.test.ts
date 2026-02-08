import { describe, test, expect } from 'bun:test';
import { Effect, Fiber } from 'effect';
import {
  createCorrelationContext,
  getCorrelationContext,
  getSpanIds,
  withCorrelationContext,
  getCurrentCorrelationContext,
  CorrelationContextRef,
} from '../../../../packages/core/src/observability/context';

describe('Correlation Context - FiberRef', () => {
  test('FiberRef context propagates through Effect.gen', async () => {
    const ctx = createCorrelationContext({
      runId: 'test-run-123',
      conversationId: 'test-conv-456',
    });

    const program = withCorrelationContext(ctx)(
      Effect.gen(function* () {
        const currentCtx = yield* getCorrelationContext;
        return currentCtx;
      })
    );

    const result = await Effect.runPromise(program);

    expect(result).toBeDefined();
    expect(result?.runId).toBe('test-run-123');
    expect(result?.conversationId).toBe('test-conv-456');
  });

  test('FiberRef context propagates through Effect.fork', async () => {
    const ctx = createCorrelationContext({
      runId: 'test-run-fork',
      intentId: 'test-intent-789',
    });

    const program = withCorrelationContext(ctx)(
      Effect.gen(function* () {
        // Fork a fiber that reads the context
        const fiber = yield* Effect.fork(
          Effect.gen(function* () {
            const currentCtx = yield* getCorrelationContext;
            return currentCtx;
          })
        );

        // Join the fiber to get its result
        const result = yield* Fiber.join(fiber);
        return result;
      })
    );

    const result = await Effect.runPromise(program);

    // The forked fiber should see the same context
    expect(result).toBeDefined();
    expect(result?.runId).toBe('test-run-fork');
    expect(result?.intentId).toBe('test-intent-789');
  });

  test('FiberRef context propagates through Effect.all', async () => {
    const ctx = createCorrelationContext({
      runId: 'test-run-parallel',
      agentId: 'test-agent-001',
    });

    const program = withCorrelationContext(ctx)(
      Effect.gen(function* () {
        // Run 3 parallel operations that all read context
        const results = yield* Effect.all([
          getCorrelationContext,
          getCorrelationContext,
          getCorrelationContext,
        ]);
        return results;
      })
    );

    const results = await Effect.runPromise(program);

    // All parallel operations should see the same context
    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(result?.runId).toBe('test-run-parallel');
      expect(result?.agentId).toBe('test-agent-001');
    });
  });

  test('ALS bridge provides context to sync accessor within Effect execution', async () => {
    const ctx = createCorrelationContext({
      runId: 'test-run-bridge',
      conversationId: 'test-conv-bridge',
    });

    const program = withCorrelationContext(ctx)(
      Effect.sync(() => {
        // Call the sync accessor from within Effect execution
        const currentCtx = getCurrentCorrelationContext();
        return currentCtx;
      })
    );

    const result = await Effect.runPromise(program);

    // Sync accessor should see context via ALS bridge
    expect(result).toBeDefined();
    expect(result?.runId).toBe('test-run-bridge');
    expect(result?.conversationId).toBe('test-conv-bridge');
  });

  test('Context is undefined outside withCorrelationContext scope', async () => {
    const program = Effect.gen(function* () {
      const currentCtx = yield* getCorrelationContext;
      return currentCtx;
    });

    const result = await Effect.runPromise(program);

    // Without wrapping, context should be undefined
    expect(result).toBeUndefined();
  });

  test('getSpanIds returns empty when no span active', async () => {
    const program = Effect.gen(function* () {
      const spanIds = yield* getSpanIds;
      return spanIds;
    });

    const result = await Effect.runPromise(program);

    // Without span layer, IDs should be undefined
    expect(result).toBeDefined();
    expect(result.traceId).toBeUndefined();
    expect(result.spanId).toBeUndefined();
  });

  test('getSpanIds returns valid IDs within Effect.withSpan', async () => {
    const program = Effect.gen(function* () {
      const spanIds = yield* getSpanIds;
      return spanIds;
    }).pipe(Effect.withSpan('test-span'));

    const result = await Effect.runPromise(program);

    // Effect.withSpan creates spans even without a collector layer
    expect(result).toBeDefined();
    expect(typeof result.traceId).toBe('string');
    expect(typeof result.spanId).toBe('string');
    expect(result.traceId).toBeTruthy();
    expect(result.spanId).toBeTruthy();
  });
});
