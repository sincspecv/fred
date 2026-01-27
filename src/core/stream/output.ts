/**
 * Stream output utilities for Fred
 *
 * Provides native streaming output functionality that handles:
 * - Step-based buffering (suppresses tool-calling text)
 * - XML tool call filtering
 * - Throttled output for readability
 * - Effect-based error handling
 */

import { Effect, Stream } from 'effect';
import type { StreamEvent } from './events.js';

/**
 * Error type for stream output operations
 */
export class StreamOutputError {
  readonly _tag = 'StreamOutputError';
  constructor(readonly message: string, readonly cause?: unknown) {}
}

/**
 * Options for streaming output
 */
export interface StreamOutputOptions {
  /** Delay between writes in ms (default: 0 for immediate) */
  throttleMs?: number;
  /** Custom write function (default: process.stdout.write) */
  write?: (text: string) => void;
  /** Prefix to show before streaming starts */
  prefix?: string;
  /** Suffix to show after streaming ends */
  suffix?: string;
}

/**
 * Process a Fred stream and output text to stdout (or custom writer)
 *
 * This is the native Fred streaming output function that:
 * - Buffers tokens per step
 * - Discards text from steps with tool calls (hides "thinking" text)
 * - Filters malformed XML tool call patterns
 * - Outputs clean response text
 *
 * @param stream - AsyncIterable of StreamEvents from Fred.streamMessage()
 * @param options - Output configuration
 * @returns Effect that resolves to the complete output text
 */
export const streamOutput = (
  stream: AsyncIterable<StreamEvent>,
  options?: StreamOutputOptions
): Effect.Effect<string, StreamOutputError> => {
  const write = options?.write ?? ((text: string) => process.stdout.write(text));
  const throttleMs = options?.throttleMs ?? 0;
  const prefix = options?.prefix ?? '';
  const suffix = options?.suffix ?? '\n\n';

  return Effect.gen(function* (_) {
    let fullText = '';
    let hasStreamedText = false;
    let currentStepHasToolCalls = false;
    let bufferedTextForCurrentStep = '';
    let lastWriteTime = 0;

    // Throttled write helper
    const throttledWrite = (text: string): Effect.Effect<void, never> =>
      Effect.sync(() => {
        if (throttleMs > 0) {
          const now = Date.now();
          const timeSinceLastWrite = now - lastWriteTime;
          if (timeSinceLastWrite < throttleMs) {
            // Note: For true async throttling, would need Effect.sleep
            // For now, this is synchronous
          }
          lastWriteTime = Date.now();
        }
        write(text);
      });

    // XML pattern for filtering malformed tool calls
    const xmlToolCallPattern = /<(?:function|tool)[^>]*>.*?<\/(?:function|tool)>/gi;

    // Show prefix if provided
    if (prefix) {
      yield* _(throttledWrite(prefix));
    }

    // Convert to Effect Stream for proper error handling
    const effectStream = Stream.fromAsyncIterable(
      stream,
      (error) => new StreamOutputError('Stream iteration failed', error)
    );

    // Process stream events
    yield* _(
      Stream.runForEach(effectStream, (event) =>
        Effect.gen(function* (_) {
          if (event.type === 'step-start') {
            currentStepHasToolCalls = false;
            bufferedTextForCurrentStep = '';
          }

          if (event.type === 'tool-call') {
            currentStepHasToolCalls = true;
            bufferedTextForCurrentStep = ''; // Discard text from this step
          }

          if (event.type === 'token' && event.delta) {
            bufferedTextForCurrentStep += event.delta;
          }

          if (event.type === 'step-end') {
            // Only output buffered text if this step had NO tool calls
            if (!currentStepHasToolCalls && bufferedTextForCurrentStep) {
              const filteredText = bufferedTextForCurrentStep
                .replace(xmlToolCallPattern, '')
                .trim();

              if (filteredText) {
                yield* _(throttledWrite(filteredText));
                fullText += filteredText;
                hasStreamedText = true;
              }
            }
            bufferedTextForCurrentStep = '';
          }

          if (event.type === 'run-end' && event.result?.content && !hasStreamedText) {
            // Fallback: if no tokens streamed, output final content
            const finalContent = event.result.content
              .replace(xmlToolCallPattern, '')
              .trim();

            if (finalContent) {
              yield* _(throttledWrite(finalContent));
              fullText = finalContent;
              hasStreamedText = true;
            }
          }

          if (event.type === 'stream-error') {
            yield* _(Effect.logError(`Stream error: ${event.error}`));
          }
        })
      )
    );

    // Show suffix if we streamed text
    if (hasStreamedText && suffix) {
      yield* _(throttledWrite(suffix));
    }

    return fullText;
  });
};

/**
 * Simple streaming output - just streams text without Effect wrapper
 *
 * For consumers who don't want Effect, this provides a simple async function
 * that handles all the streaming logic internally.
 *
 * @param stream - AsyncIterable of StreamEvents from Fred.streamMessage()
 * @param options - Output configuration
 * @returns Promise that resolves to the complete output text
 */
export const streamOutputSimple = async (
  stream: AsyncIterable<StreamEvent>,
  options?: StreamOutputOptions
): Promise<string> => {
  return Effect.runPromise(streamOutput(stream, options));
};
