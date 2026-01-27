/**
 * Stream output utilities for Fred
 *
 * Provides native streaming output functionality that handles:
 * - Step-based buffering (suppresses tool-calling text)
 * - XML tool call filtering
 * - Effect-based error handling throughout
 */

import { Effect, Stream, Ref, pipe } from 'effect';
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
 * State for tracking step-based buffering
 */
interface OutputState {
  hasStreamedText: boolean;
  currentStepHasToolCalls: boolean;
  bufferedTextForCurrentStep: string;
  fullText: string;
}

/**
 * Process a stream event and update state accordingly
 */
const processEvent = (
  event: StreamEvent,
  state: OutputState
): { newState: OutputState; textToOutput: string | null } => {
  const xmlToolCallPattern = /<(?:function|tool)[^>]*>.*?<\/(?:function|tool)>/gi;

  if (event.type === 'step-start') {
    return {
      newState: {
        ...state,
        currentStepHasToolCalls: false,
        bufferedTextForCurrentStep: '',
      },
      textToOutput: null,
    };
  }

  if (event.type === 'tool-call') {
    return {
      newState: {
        ...state,
        currentStepHasToolCalls: true,
        bufferedTextForCurrentStep: '',
      },
      textToOutput: null,
    };
  }

  if (event.type === 'token' && event.delta) {
    return {
      newState: {
        ...state,
        bufferedTextForCurrentStep: state.bufferedTextForCurrentStep + event.delta,
      },
      textToOutput: null,
    };
  }

  if (event.type === 'step-end') {
    if (!state.currentStepHasToolCalls && state.bufferedTextForCurrentStep) {
      const filteredText = state.bufferedTextForCurrentStep
        .replace(xmlToolCallPattern, '')
        .trim();

      if (filteredText) {
        return {
          newState: {
            ...state,
            hasStreamedText: true,
            fullText: state.fullText + filteredText,
            bufferedTextForCurrentStep: '',
          },
          textToOutput: filteredText,
        };
      }
    }
    return {
      newState: { ...state, bufferedTextForCurrentStep: '' },
      textToOutput: null,
    };
  }

  if (event.type === 'run-end' && event.result?.content && !state.hasStreamedText) {
    const finalContent = event.result.content
      .replace(xmlToolCallPattern, '')
      .trim();

    if (finalContent) {
      return {
        newState: {
          ...state,
          hasStreamedText: true,
          fullText: finalContent,
        },
        textToOutput: finalContent,
      };
    }
  }

  return { newState: state, textToOutput: null };
};

/**
 * Process a Fred stream and output text to stdout (or custom writer)
 *
 * This is the native Fred streaming output function that:
 * - Buffers tokens per step
 * - Discards text from steps with tool calls (hides "thinking" text)
 * - Filters malformed XML tool call patterns
 * - Outputs clean response text
 *
 * Uses Effect throughout for proper functional composition and error handling.
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
  const prefix = options?.prefix ?? '';
  const suffix = options?.suffix ?? '\n\n';

  return Effect.gen(function* () {
    // Create state ref for tracking output
    const stateRef = yield* Ref.make<OutputState>({
      hasStreamedText: false,
      currentStepHasToolCalls: false,
      bufferedTextForCurrentStep: '',
      fullText: '',
    });

    // Write helper using Effect.sync
    const writeText = (text: string) => Effect.sync(() => write(text));

    // Show prefix if provided
    if (prefix) {
      yield* writeText(prefix);
    }

    // Convert to Effect Stream for proper error handling
    const effectStream = Stream.fromAsyncIterable(
      stream,
      (error) => new StreamOutputError('Stream iteration failed', error)
    );

    // Process stream events using Effect
    yield* pipe(
      effectStream,
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(stateRef);
          const { newState, textToOutput } = processEvent(event, currentState);
          yield* Ref.set(stateRef, newState);

          if (textToOutput) {
            yield* writeText(textToOutput);
          }
        })
      ),
      Stream.runDrain
    );

    // Get final state
    const finalState = yield* Ref.get(stateRef);

    // Show suffix if we streamed text
    if (finalState.hasStreamedText && suffix) {
      yield* writeText(suffix);
    }

    return finalState.fullText;
  });
};

/**
 * Simple streaming output - runs the Effect and returns a Promise
 *
 * For consumers who prefer Promise-based APIs, this provides a simple
 * async function that handles all the streaming logic internally.
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
