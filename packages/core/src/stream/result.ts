import { Effect, Stream } from 'effect';
import type { StreamEvent, TokenEvent, UsageEvent, ToolCallEvent, ToolResultEvent } from './events';

/**
 * Stream status indicating current state
 */
export type StreamStatus = 'streaming' | 'complete' | 'error';

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Tool call information extracted from stream
 */
export interface ToolCallInfo {
  toolId: string;
  args: Record<string, unknown>;
  result?: unknown;
}

/**
 * Options for creating a StreamResult
 */
export interface StreamResultOptions {
  /** Effect Stream of events */
  stream: Stream.Stream<StreamEvent, Error>;

  /** Optional callbacks - set before iteration starts */
  onChunk?: (chunk: StreamEvent) => void;
  onFinish?: (result: { text: string; usage: TokenUsage; steps: number }) => void;
  onError?: (error: Error) => void;
}

/**
 * StreamResult - Rich streaming result object following Vercel AI SDK pattern.
 *
 * Provides multiple ways to consume streaming responses:
 *
 * 1. AsyncIterable streams:
 *    - `textStream` - yields only text content
 *    - `fullStream` - yields all StreamEvent objects
 *
 * 2. Callbacks:
 *    - `onChunk(event)` - called for each event
 *    - `onFinish({ text, usage, steps })` - called when stream completes
 *    - `onError(error)` - called on stream error
 *
 * 3. Promise accessors (lazy evaluation):
 *    - `text` - resolves to full aggregated text
 *    - `usage` - resolves to token usage stats
 *    - `steps` - resolves to array of step responses
 *
 * @example Basic text streaming
 * ```typescript
 * const result = fred.streamMessage('Hello');
 *
 * for await (const text of result.textStream) {
 *   process.stdout.write(text);
 * }
 * ```
 *
 * @example Full event streaming with callbacks
 * ```typescript
 * const result = fred.streamMessage('Hello');
 *
 * result.onChunk = (event) => console.log('Event:', event.type);
 * result.onFinish = ({ text, usage }) => console.log('Done:', text.length, 'tokens:', usage.totalTokens);
 *
 * for await (const event of result.fullStream) {
 *   // Process events
 * }
 * ```
 *
 * @example Await final result
 * ```typescript
 * const result = fred.streamMessage('Hello');
 * const finalText = await result.text;
 * const usage = await result.usage;
 * ```
 */
export interface StreamResult {
  /**
   * AsyncIterable of text chunks only.
   * Filters stream to just text events and yields their content.
   */
  readonly textStream: AsyncIterable<string>;

  /**
   * AsyncIterable of all stream events.
   * Yields every StreamEvent including text, tool calls, step boundaries.
   */
  readonly fullStream: AsyncIterable<StreamEvent>;

  /**
   * Callback invoked for each stream event.
   * Set before starting iteration to receive all events.
   */
  onChunk?: (chunk: StreamEvent) => void;

  /**
   * Callback invoked when stream completes successfully.
   */
  onFinish?: (result: { text: string; usage: TokenUsage; steps: number }) => void;

  /**
   * Callback invoked on stream error.
   */
  onError?: (error: Error) => void;

  /**
   * Promise resolving to the full aggregated text response.
   * Consumes the stream internally - only one of text/usage/steps should be awaited
   * unless you're also consuming the stream.
   */
  readonly text: Promise<string>;

  /**
   * Promise resolving to token usage statistics.
   */
  readonly usage: Promise<TokenUsage>;

  /**
   * Promise resolving to the number of steps executed.
   */
  readonly steps: Promise<number>;

  /**
   * Current stream status (synchronous).
   * Returns 'streaming' while active, 'complete' when finished, 'error' on failure.
   */
  readonly status: StreamStatus;

  /**
   * Stored error if status is 'error', null otherwise (synchronous).
   */
  readonly error: Error | null;

  /**
   * Promise resolving to array of tool calls with their results.
   * Consumes the stream internally.
   */
  readonly toolCalls: Promise<ToolCallInfo[]>;

  /**
   * Collect all events into an array.
   * Consumes the stream internally.
   */
  toArray(): Promise<StreamEvent[]>;

  /**
   * Alias for text getter.
   */
  toText(): Promise<string>;

  /**
   * Execute callback for each event.
   * If stream already consumed, replays cached events.
   * If not yet consumed, iterates live stream.
   */
  onEvent(callback: (event: StreamEvent) => void | Promise<void>): Promise<void>;

  /**
   * AsyncIterator for backward compatibility.
   * Enables: for await (const event of result) { ... }
   */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
}

/**
 * Implementation of StreamResult
 */
export class StreamResultImpl implements StreamResult {
  private effectStream: Stream.Stream<StreamEvent, Error>;
  private consumed = false;
  private collectedEvents: StreamEvent[] | null = null;
  private textPromise: Promise<string> | null = null;
  private usagePromise: Promise<TokenUsage> | null = null;
  private stepsPromise: Promise<number> | null = null;
  private toolCallsPromise: Promise<ToolCallInfo[]> | null = null;

  // Status tracking
  private _status: StreamStatus = 'streaming';
  private _error: Error | null = null;

  // Tool calls tracking
  private _toolCalls: ToolCallInfo[] = [];

  // Callbacks
  onChunk?: (chunk: StreamEvent) => void;
  onFinish?: (result: { text: string; usage: TokenUsage; steps: number }) => void;
  onError?: (error: Error) => void;

  constructor(options: StreamResultOptions) {
    this.effectStream = options.stream;
    this.onChunk = options.onChunk;
    this.onFinish = options.onFinish;
    this.onError = options.onError;
  }

  /**
   * Current stream status (synchronous)
   */
  get status(): StreamStatus {
    return this._status;
  }

  /**
   * Stored error if status is 'error' (synchronous)
   */
  get error(): Error | null {
    return this._error;
  }

  get textStream(): AsyncIterable<string> {
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of self.fullStream) {
          if (event.type === 'token' && (event as TokenEvent).delta) {
            yield (event as TokenEvent).delta;
          }
        }
      }
    };
  }

  get fullStream(): AsyncIterable<StreamEvent> {
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        if (self.consumed && self.collectedEvents) {
          // Replay from cache if already consumed
          for (const event of self.collectedEvents) {
            self.onChunk?.(event);
            yield event;
          }
          return;
        }

        self.consumed = true;
        self.collectedEvents = [];

        let textAcc = '';
        let usageAcc: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let stepCount = 0;

        try {
          // Convert Effect Stream to AsyncIterable
          const iterator = streamToAsyncIterator(self.effectStream);

          for await (const event of iterator) {
            self.collectedEvents.push(event);
            self.onChunk?.(event);

            // Accumulate text from token events
            if (event.type === 'token' && (event as TokenEvent).delta) {
              textAcc += (event as TokenEvent).delta;
            }

            // Track step count
            if (event.type === 'step-start') {
              stepCount++;
            }

            // Accumulate usage if present
            if (event.type === 'usage' && (event as UsageEvent).usage) {
              const u = (event as UsageEvent).usage;
              usageAcc.promptTokens += u.inputTokens || 0;
              usageAcc.completionTokens += u.outputTokens || 0;
              usageAcc.totalTokens += u.totalTokens || 0;
            }

            // Track tool calls
            if (event.type === 'tool-call') {
              const toolCallEvent = event as ToolCallEvent;
              self._toolCalls.push({
                toolId: toolCallEvent.toolName,
                args: toolCallEvent.input,
              });
            }

            // Track tool results
            if (event.type === 'tool-result') {
              const toolResultEvent = event as ToolResultEvent;
              // Find matching tool call and set result
              const toolCall = self._toolCalls.find(
                tc => tc.toolId === toolResultEvent.toolName && tc.result === undefined
              );
              if (toolCall) {
                toolCall.result = toolResultEvent.output;
              }
            }

            yield event;
          }

          // Mark as complete
          self._status = 'complete';

          // Call onFinish
          self.onFinish?.({ text: textAcc, usage: usageAcc, steps: stepCount });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          self._status = 'error';
          self._error = err;
          self.onError?.(err);
          throw err;
        }
      }
    };
  }

  get text(): Promise<string> {
    if (!this.textPromise) {
      this.textPromise = this.collectText();
    }
    return this.textPromise;
  }

  get usage(): Promise<TokenUsage> {
    if (!this.usagePromise) {
      this.usagePromise = this.collectUsage();
    }
    return this.usagePromise;
  }

  get steps(): Promise<number> {
    if (!this.stepsPromise) {
      this.stepsPromise = this.collectSteps();
    }
    return this.stepsPromise;
  }

  get toolCalls(): Promise<ToolCallInfo[]> {
    if (!this.toolCallsPromise) {
      this.toolCallsPromise = this.collectToolCalls();
    }
    return this.toolCallsPromise;
  }

  private async collectToolCalls(): Promise<ToolCallInfo[]> {
    await this.consumeIfNeeded();
    return [...this._toolCalls];
  }

  async toArray(): Promise<StreamEvent[]> {
    await this.consumeIfNeeded();
    return [...this.collectedEvents!];
  }

  async toText(): Promise<string> {
    return this.text;
  }

  async onEvent(callback: (event: StreamEvent) => void | Promise<void>): Promise<void> {
    for await (const event of this.fullStream) {
      await callback(event);
    }
  }

  /**
   * AsyncIterator for backward compatibility.
   * Enables: for await (const event of result) { ... }
   */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return this.fullStream[Symbol.asyncIterator]();
  }

  private async collectText(): Promise<string> {
    // Ensure stream is consumed
    await this.consumeIfNeeded();
    return this.collectedEvents!
      .filter(e => e.type === 'token' && (e as TokenEvent).delta)
      .map(e => (e as TokenEvent).delta)
      .join('');
  }

  private async collectUsage(): Promise<TokenUsage> {
    await this.consumeIfNeeded();
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    for (const event of this.collectedEvents!) {
      if (event.type === 'usage' && (event as UsageEvent).usage) {
        const u = (event as UsageEvent).usage;
        usage.promptTokens += u.inputTokens || 0;
        usage.completionTokens += u.outputTokens || 0;
        usage.totalTokens += u.totalTokens || 0;
      }
    }
    return usage;
  }

  private async collectSteps(): Promise<number> {
    await this.consumeIfNeeded();
    return this.collectedEvents!.filter(e => e.type === 'step-start').length;
  }

  private async consumeIfNeeded(): Promise<void> {
    if (!this.consumed) {
      // Force consumption by iterating
      for await (const _ of this.fullStream) {
        // Just consume
      }
    }
  }
}

/**
 * Convert Effect Stream to AsyncIterator
 */
async function* streamToAsyncIterator<A, E>(
  stream: Stream.Stream<A, E>
): AsyncGenerator<A, void, unknown> {
  const asyncIterable = Stream.toAsyncIterable(stream);
  for await (const chunk of asyncIterable) {
    yield chunk;
  }
}

/**
 * Create a StreamResult from an Effect Stream
 */
export const createStreamResult = (
  stream: Stream.Stream<StreamEvent, Error>,
  options?: Partial<StreamResultOptions>
): StreamResult => {
  return new StreamResultImpl({
    stream,
    onChunk: options?.onChunk,
    onFinish: options?.onFinish,
    onError: options?.onError,
  });
};

/**
 * Create a StreamResult from an AsyncIterable
 */
export const createStreamResultFromIterable = (
  iterable: AsyncIterable<StreamEvent>,
  options?: Partial<StreamResultOptions>
): StreamResult => {
  // Convert AsyncIterable to Effect Stream
  const stream = Stream.fromAsyncIterable(iterable, (error) =>
    error instanceof Error ? error : new Error(String(error))
  );

  return createStreamResult(stream, options);
};
