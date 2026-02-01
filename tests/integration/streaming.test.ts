import { describe, it, expect } from 'bun:test';
import type { StreamEvent } from '../../packages/core/src/stream/events';
import { Stream } from 'effect';
import { createStreamResult, createStreamResultFromIterable } from '../../packages/core/src/stream/result';

/**
 * Integration tests for StreamResult API.
 *
 * These tests verify:
 * 1. StreamResult has all expected properties/methods
 * 2. Symbol.asyncIterator allows direct iteration (backward compatibility)
 * 3. PROV-03: Agents can stream responses
 *
 * Note: Fred.streamMessage() returns StreamResult, which is verified by
 * checking the return type in the Fred class tests. These integration tests
 * focus on StreamResult behavior with controlled mock streams.
 */

/**
 * Helper to create a complete mock stream with typical events
 */
const createMockStreamEvents = (): StreamEvent[] => [
  {
    type: 'step-start',
    stepIndex: 0,
    runId: 'test-run',
    sequence: 0,
    emittedAt: Date.now(),
  },
  {
    type: 'token',
    messageId: 'test-msg',
    step: 0,
    delta: 'Hello',
    accumulated: 'Hello',
    runId: 'test-run',
    sequence: 1,
    emittedAt: Date.now(),
  },
  {
    type: 'token',
    messageId: 'test-msg',
    step: 0,
    delta: ' World',
    accumulated: 'Hello World',
    runId: 'test-run',
    sequence: 2,
    emittedAt: Date.now(),
  },
  {
    type: 'usage',
    messageId: 'test-msg',
    step: 0,
    runId: 'test-run',
    sequence: 3,
    emittedAt: Date.now(),
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
  },
  {
    type: 'step-end',
    stepIndex: 0,
    runId: 'test-run',
    sequence: 4,
    emittedAt: Date.now(),
  },
];

describe('Fred.streamMessage() returns StreamResult', () => {
  /**
   * Fred.streamMessage() returns StreamResult - verified by:
   * 1. src/index.ts: Fred.streamMessage delegates to MessageProcessor.streamMessage
   * 2. src/core/message-processor/processor.ts: returns createStreamResultFromIterable(...)
   * 3. These tests verify StreamResult API completeness with mock streams
   */

  describe('StreamResult API completeness', () => {
    it('has all expected properties', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);

      // Verify result has expected properties
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('fullStream');
      expect(result).toHaveProperty('textStream');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('usage');
      expect(result).toHaveProperty('steps');
      expect(result).toHaveProperty('toolCalls');
      expect(result).toHaveProperty('toArray');
      expect(result).toHaveProperty('toText');
      expect(result).toHaveProperty('onEvent');
      expect(result).toHaveProperty('onChunk');
      expect(result).toHaveProperty('onFinish');
      expect(result).toHaveProperty('onError');
    });

    it('has Symbol.asyncIterator method (backward compatibility)', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);

      // CRITICAL: Verify Symbol.asyncIterator is a function
      // This enables `for await (const event of result)` syntax
      expect(typeof result[Symbol.asyncIterator]).toBe('function');
    });

    it('status starts as streaming', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);

      // Before any consumption, status should be 'streaming'
      expect(result.status).toBe('streaming');
    });

    it('error is null initially', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.error).toBeNull();
    });

    it('text is a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.text instanceof Promise).toBe(true);
    });

    it('usage is a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.usage instanceof Promise).toBe(true);
    });

    it('steps is a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.steps instanceof Promise).toBe(true);
    });

    it('toolCalls is a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.toolCalls instanceof Promise).toBe(true);
    });

    it('toArray returns a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.toArray() instanceof Promise).toBe(true);
    });

    it('toText returns a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(result.toText() instanceof Promise).toBe(true);
    });

    it('onEvent returns a Promise', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      const promise = result.onEvent(() => {});
      expect(promise instanceof Promise).toBe(true);
    });

    it('textStream is iterable', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(typeof result.textStream[Symbol.asyncIterator]).toBe('function');
    });

    it('fullStream is iterable', () => {
      const stream = Stream.fromIterable(createMockStreamEvents());
      const result = createStreamResult(stream);
      expect(typeof result.fullStream[Symbol.asyncIterator]).toBe('function');
    });
  });
});

/**
 * Tests for backward compatibility - verifying that old patterns still work.
 * These are critical for migration from older Fred versions.
 */
describe('StreamResult backward compatibility', () => {
  describe('Symbol.asyncIterator delegation', () => {
    it('allows for-await-of directly on StreamResult', async () => {
      const mockEvents = createMockStreamEvents();
      const stream = Stream.fromIterable(mockEvents);
      const result = createStreamResult(stream);

      // CRITICAL: This test verifies backward compatibility
      // Users must be able to do `for await (const event of result)`
      // WITHOUT accessing .fullStream explicitly
      const events: StreamEvent[] = [];
      for await (const event of result) {
        events.push(event);
      }

      // If we got here without error, Symbol.asyncIterator delegation works
      expect(events.length).toBe(5);
      expect(events[0].type).toBe('step-start');
      expect(events[1].type).toBe('token');
      expect(events[2].type).toBe('token');
      expect(events[3].type).toBe('usage');
      expect(events[4].type).toBe('step-end');
    });

    it('yields same events whether using result directly or result.fullStream', async () => {
      const mockEvents = createMockStreamEvents();

      // Test with direct iteration
      const stream1 = Stream.fromIterable(mockEvents);
      const result1 = createStreamResult(stream1);
      const directEvents: StreamEvent[] = [];
      for await (const event of result1) {
        directEvents.push(event);
      }

      // Test with fullStream
      const stream2 = Stream.fromIterable(mockEvents);
      const result2 = createStreamResult(stream2);
      const fullStreamEvents: StreamEvent[] = [];
      for await (const event of result2.fullStream) {
        fullStreamEvents.push(event);
      }

      // Both should yield identical events
      expect(directEvents.length).toBe(fullStreamEvents.length);
      for (let i = 0; i < directEvents.length; i++) {
        expect(directEvents[i].type).toBe(fullStreamEvents[i].type);
        if (directEvents[i].type === 'token') {
          expect((directEvents[i] as any).delta).toBe((fullStreamEvents[i] as any).delta);
        }
      }
    });
  });

  describe('createStreamResultFromIterable', () => {
    it('creates StreamResult from async generator', async () => {
      async function* generateEvents(): AsyncGenerator<StreamEvent> {
        yield {
          type: 'token',
          messageId: 'test-msg',
          step: 0,
          delta: 'Test',
          accumulated: 'Test',
          runId: 'test-run',
          sequence: 0,
          emittedAt: Date.now(),
        };
      }

      const result = createStreamResultFromIterable(generateEvents());

      // Verify it's a proper StreamResult
      expect(result.status).toBe('streaming');
      expect(typeof result[Symbol.asyncIterator]).toBe('function');

      const text = await result.text;
      expect(text).toBe('Test');
    });
  });
});

/**
 * Tests for status transitions and error handling
 */
describe('StreamResult status and error handling', () => {
  it('status transitions to complete after full consumption', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    expect(result.status).toBe('streaming');

    // Consume the stream
    for await (const _ of result) {}

    expect(result.status).toBe('complete');
  });

  it('status transitions to error on stream failure', async () => {
    const errorStream = Stream.fail(new Error('Stream failed'));
    const result = createStreamResult(errorStream);

    expect(result.status).toBe('streaming');
    expect(result.error).toBeNull();

    try {
      for await (const _ of result) {}
    } catch {
      // Expected to throw
    }

    expect(result.status).toBe('error');
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toBe('Stream failed');
  });
});

/**
 * PROV-03 requirement: Agents can stream responses
 * This verifies that the streaming infrastructure is properly integrated.
 */
describe('PROV-03: Agents can stream responses', () => {
  it('StreamResult provides textStream for text-only consumption', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    // textStream should only yield text content, not step events
    const texts: string[] = [];
    for await (const text of result.textStream) {
      texts.push(text);
    }

    expect(texts).toEqual(['Hello', ' World']);
  });

  it('StreamResult provides fullStream for all events', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    // fullStream should yield all events including step boundaries
    const events: StreamEvent[] = [];
    for await (const event of result.fullStream) {
      events.push(event);
    }

    expect(events.length).toBe(5);
    expect(events.map(e => e.type)).toEqual(['step-start', 'token', 'token', 'usage', 'step-end']);
  });

  it('StreamResult text Promise resolves to aggregated text', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    const text = await result.text;
    expect(text).toBe('Hello World');
  });

  it('StreamResult supports onFinish callback', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    let finishCalled = false;
    let finishResult: any = null;

    const result = createStreamResult(stream, {
      onFinish: (r) => {
        finishCalled = true;
        finishResult = r;
      },
    });

    // Consume the stream
    for await (const _ of result) {}

    expect(finishCalled).toBe(true);
    expect(finishResult).not.toBeNull();
    expect(finishResult.text).toBe('Hello World');
    expect(finishResult.usage.promptTokens).toBe(10);
    expect(finishResult.usage.completionTokens).toBe(5);
    expect(finishResult.steps).toBe(1);
  });

  it('StreamResult supports onChunk callback', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const chunks: StreamEvent[] = [];

    const result = createStreamResult(stream, {
      onChunk: (chunk) => chunks.push(chunk),
    });

    // Consume the stream
    for await (const _ of result) {}

    expect(chunks.length).toBe(5);
    expect(chunks[0].type).toBe('step-start');
    expect(chunks[1].type).toBe('token');
  });

  it('StreamResult supports onError callback', async () => {
    const errorStream = Stream.fail(new Error('Stream error'));
    let errorCalled = false;
    let capturedError: Error | null = null;

    const result = createStreamResult(errorStream, {
      onError: (e) => {
        errorCalled = true;
        capturedError = e;
      },
    });

    try {
      for await (const _ of result) {}
    } catch {
      // Expected
    }

    expect(errorCalled).toBe(true);
    expect(capturedError).not.toBeNull();
    expect(capturedError!.message).toBe('Stream error');
  });

  it('StreamResult toolCalls collects tool call information', async () => {
    const eventsWithTools: StreamEvent[] = [
      {
        type: 'step-start',
        stepIndex: 0,
        runId: 'test-run',
        sequence: 0,
        emittedAt: Date.now(),
      },
      {
        type: 'tool-call',
        messageId: 'test-msg',
        step: 0,
        toolCallId: 'call_1',
        toolName: 'calculator',
        input: { expression: '2+2' },
        startedAt: Date.now(),
        runId: 'test-run',
        sequence: 1,
        emittedAt: Date.now(),
      },
      {
        type: 'tool-result',
        messageId: 'test-msg',
        step: 0,
        toolCallId: 'call_1',
        toolName: 'calculator',
        output: '4',
        completedAt: Date.now(),
        durationMs: 10,
        runId: 'test-run',
        sequence: 2,
        emittedAt: Date.now(),
      },
      {
        type: 'step-end',
        stepIndex: 0,
        runId: 'test-run',
        sequence: 3,
        emittedAt: Date.now(),
      },
    ];

    const stream = Stream.fromIterable(eventsWithTools);
    const result = createStreamResult(stream);

    const toolCalls = await result.toolCalls;
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolId).toBe('calculator');
    expect(toolCalls[0].args).toEqual({ expression: '2+2' });
    expect(toolCalls[0].result).toBe('4');
  });

  it('StreamResult toArray returns all events', async () => {
    const mockEvents = createMockStreamEvents();
    const stream = Stream.fromIterable(mockEvents);
    const result = createStreamResult(stream);

    const events = await result.toArray();
    expect(events.length).toBe(5);
    expect(events.map(e => e.type)).toEqual(['step-start', 'token', 'token', 'usage', 'step-end']);
  });

  it('StreamResult toText returns aggregated text', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    const text = await result.toText();
    expect(text).toBe('Hello World');
  });

  it('StreamResult usage accumulates from usage events', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    const usage = await result.usage;
    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(5);
    expect(usage.totalTokens).toBe(15);
  });

  it('StreamResult steps counts step-start events', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    const steps = await result.steps;
    expect(steps).toBe(1);
  });
});

/**
 * Tests verifying StreamResult API mirrors expected Fred.streamMessage() behavior
 */
describe('Fred.streamMessage() behavior verification', () => {
  /**
   * The Fred.streamMessage() method is defined in src/index.ts:
   *
   *   streamMessage(message: string, options?: ProcessingOptions): StreamResult {
   *     return this.messageProcessor.streamMessage(message, options);
   *   }
   *
   * And MessageProcessor.streamMessage() returns createStreamResultFromIterable().
   *
   * These tests verify that the StreamResult returned behaves correctly.
   */

  it('StreamResult from iterable has same API as StreamResult from stream', async () => {
    // Create both types of StreamResult
    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      yield* createMockStreamEvents();
    }

    const resultFromIterable = createStreamResultFromIterable(generateEvents());
    const resultFromStream = createStreamResult(Stream.fromIterable(createMockStreamEvents()));

    // Both should have the same API
    expect(typeof resultFromIterable.status).toBe(typeof resultFromStream.status);
    expect(typeof resultFromIterable.error).toBe(typeof resultFromStream.error);
    expect(typeof resultFromIterable[Symbol.asyncIterator]).toBe('function');
    expect(typeof resultFromStream[Symbol.asyncIterator]).toBe('function');
  });

  it('StreamResult supports concurrent text and event consumption via caching', async () => {
    const stream = Stream.fromIterable(createMockStreamEvents());
    const result = createStreamResult(stream);

    // First: consume via fullStream
    const events1: StreamEvent[] = [];
    for await (const event of result.fullStream) {
      events1.push(event);
    }

    // Second: consume via text (should use cached events)
    const text = await result.text;

    // Third: consume via fullStream again (replay from cache)
    const events2: StreamEvent[] = [];
    for await (const event of result.fullStream) {
      events2.push(event);
    }

    expect(events1.length).toBe(5);
    expect(events2.length).toBe(5);
    expect(text).toBe('Hello World');
  });
});
