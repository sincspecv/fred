import { describe, test, expect } from 'bun:test';
import { Stream } from 'effect';
import {
  StreamResultImpl,
  createStreamResult,
  createStreamResultFromIterable,
  type TokenUsage
} from '../../../../src/core/stream/result';
import type { StreamEvent, TokenEvent, StepStartEvent, StepEndEvent, UsageEvent } from '../../../../src/core/stream/events';

// Helper to create test events
const createTokenEvent = (delta: string, accumulated: string = delta): StreamEvent => ({
  type: 'token',
  delta,
  accumulated,
  messageId: 'test-msg',
  step: 0,
  runId: 'test-run',
  sequence: 1,
  emittedAt: Date.now(),
});

const createStepStartEvent = (stepIndex: number): StreamEvent => ({
  type: 'step-start',
  stepIndex,
  runId: 'test-run',
  sequence: stepIndex,
  emittedAt: Date.now(),
});

const createStepEndEvent = (stepIndex: number): StreamEvent => ({
  type: 'step-end',
  stepIndex,
  runId: 'test-run',
  sequence: stepIndex * 2 + 1,
  emittedAt: Date.now(),
});

const createUsageEvent = (inputTokens: number, outputTokens: number): StreamEvent => ({
  type: 'usage',
  messageId: 'test-msg',
  step: 0,
  runId: 'test-run',
  sequence: 100,
  emittedAt: Date.now(),
  usage: {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  },
});

describe('StreamResult', () => {
  describe('textStream', () => {
    test('yields only text content from token events', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Hello '),
        createTokenEvent('World', 'Hello World'),
        createStepEndEvent(0),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const texts: string[] = [];
      for await (const text of result.textStream) {
        texts.push(text);
      }

      expect(texts).toEqual(['Hello ', 'World']);
    });

    test('handles empty stream', async () => {
      const stream = Stream.fromIterable([]);
      const result = createStreamResult(stream);

      const texts: string[] = [];
      for await (const text of result.textStream) {
        texts.push(text);
      }

      expect(texts).toEqual([]);
    });

    test('filters non-token events', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createStepEndEvent(0),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const texts: string[] = [];
      for await (const text of result.textStream) {
        texts.push(text);
      }

      expect(texts).toEqual([]);
    });
  });

  describe('fullStream', () => {
    test('yields all events', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Hello'),
        createStepEndEvent(0),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const collected: StreamEvent[] = [];
      for await (const event of result.fullStream) {
        collected.push(event);
      }

      expect(collected.length).toBe(3);
      expect(collected[0].type).toBe('step-start');
      expect(collected[1].type).toBe('token');
      expect(collected[2].type).toBe('step-end');
    });

    test('can be replayed after consumption', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello'),
        createTokenEvent('World', 'HelloWorld'),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      // First consumption
      const first: StreamEvent[] = [];
      for await (const event of result.fullStream) {
        first.push(event);
      }

      // Second consumption (replay)
      const second: StreamEvent[] = [];
      for await (const event of result.fullStream) {
        second.push(event);
      }

      expect(first.length).toBe(2);
      expect(second.length).toBe(2);
      expect(first[0].type).toBe(second[0].type);
      expect(first[1].type).toBe(second[1].type);
    });
  });

  describe('callbacks', () => {
    test('onChunk called for each event', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello'),
        createTokenEvent('World', 'HelloWorld'),
      ];

      const chunks: StreamEvent[] = [];
      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream, {
        onChunk: (chunk) => chunks.push(chunk),
      });

      // Consume to trigger callbacks
      for await (const _ of result.fullStream) {}

      expect(chunks.length).toBe(2);
    });

    test('onChunk called during replay', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello'),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      // First consumption
      for await (const _ of result.fullStream) {}

      // Set callback after first consumption
      const chunks: StreamEvent[] = [];
      result.onChunk = (chunk) => chunks.push(chunk);

      // Second consumption (replay)
      for await (const _ of result.fullStream) {}

      expect(chunks.length).toBe(1);
    });

    test('onFinish called with aggregated results', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Hello '),
        createTokenEvent('World', 'Hello World'),
        createStepEndEvent(0),
      ];

      let finishResult: { text: string; usage: TokenUsage; steps: number } | null = null;
      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream, {
        onFinish: (r) => { finishResult = r; },
      });

      for await (const _ of result.fullStream) {}

      expect(finishResult).not.toBeNull();
      expect(finishResult!.text).toBe('Hello World');
      expect(finishResult!.steps).toBe(1);
    });

    test('onFinish includes usage from usage events', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Hello'),
        createUsageEvent(10, 5),
        createStepEndEvent(0),
      ];

      let finishResult: { text: string; usage: TokenUsage; steps: number } | null = null;
      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream, {
        onFinish: (r) => { finishResult = r; },
      });

      for await (const _ of result.fullStream) {}

      expect(finishResult).not.toBeNull();
      expect(finishResult!.usage.promptTokens).toBe(10);
      expect(finishResult!.usage.completionTokens).toBe(5);
      expect(finishResult!.usage.totalTokens).toBe(15);
    });

    test('onError called on stream error', async () => {
      const errorStream = Stream.fail(new Error('Test error'));
      let caughtError: Error | null = null;

      const result = createStreamResult(errorStream, {
        onError: (e) => { caughtError = e; },
      });

      try {
        for await (const _ of result.fullStream) {}
      } catch {}

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Test error');
    });
  });

  describe('promise accessors', () => {
    test('text resolves to aggregated text', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello '),
        createTokenEvent('World', 'Hello World'),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const text = await result.text;
      expect(text).toBe('Hello World');
    });

    test('steps resolves to step count', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Step 1'),
        createStepEndEvent(0),
        createStepStartEvent(1),
        createTokenEvent('Step 2'),
        createStepEndEvent(1),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const steps = await result.steps;
      expect(steps).toBe(2);
    });

    test('usage accumulates from usage events', async () => {
      const events: StreamEvent[] = [
        createStepStartEvent(0),
        createTokenEvent('Hello'),
        createUsageEvent(10, 5),
        createStepEndEvent(0),
        createStepStartEvent(1),
        createTokenEvent('World'),
        createUsageEvent(8, 4),
        createStepEndEvent(1),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const usage = await result.usage;
      expect(usage.promptTokens).toBe(18); // 10 + 8
      expect(usage.completionTokens).toBe(9); // 5 + 4
      expect(usage.totalTokens).toBe(27); // 15 + 12
    });

    test('usage returns zeros when no usage events', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello'),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      const usage = await result.usage;
      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    test('promise accessors are lazy and cached', async () => {
      const events: StreamEvent[] = [
        createTokenEvent('Hello'),
      ];

      const stream = Stream.fromIterable(events);
      const result = createStreamResult(stream);

      // Get text promise twice - should be same instance
      const textPromise1 = result.text;
      const textPromise2 = result.text;
      expect(textPromise1).toBe(textPromise2);

      const text1 = await textPromise1;
      const text2 = await textPromise2;
      expect(text1).toBe(text2);
      expect(text1).toBe('Hello');
    });
  });

  describe('createStreamResultFromIterable', () => {
    test('creates result from async iterable', async () => {
      async function* generateEvents(): AsyncGenerator<StreamEvent> {
        yield createTokenEvent('Hello');
        yield createTokenEvent(' World', 'Hello World');
      }

      const result = createStreamResultFromIterable(generateEvents());
      const text = await result.text;

      expect(text).toBe('Hello World');
    });

    test('supports callbacks with async iterable', async () => {
      async function* generateEvents(): AsyncGenerator<StreamEvent> {
        yield createStepStartEvent(0);
        yield createTokenEvent('Test');
        yield createStepEndEvent(0);
      }

      const chunks: StreamEvent[] = [];
      const result = createStreamResultFromIterable(generateEvents(), {
        onChunk: (chunk) => chunks.push(chunk),
      });

      for await (const _ of result.fullStream) {}

      expect(chunks.length).toBe(3);
    });
  });

  describe('StreamResultImpl constructor', () => {
    test('accepts all options', () => {
      const stream = Stream.fromIterable([]);
      const onChunk = () => {};
      const onFinish = () => {};
      const onError = () => {};

      const result = new StreamResultImpl({
        stream,
        onChunk,
        onFinish,
        onError,
      });

      expect(result.onChunk).toBe(onChunk);
      expect(result.onFinish).toBe(onFinish);
      expect(result.onError).toBe(onError);
    });

    test('callbacks can be set after construction', () => {
      const stream = Stream.fromIterable([]);
      const result = new StreamResultImpl({ stream });

      expect(result.onChunk).toBeUndefined();

      const onChunk = () => {};
      result.onChunk = onChunk;

      expect(result.onChunk).toBe(onChunk);
    });
  });
});
