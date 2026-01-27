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
  /**
   * Stream tokens immediately as they arrive (true) or buffer until step-end (false).
   * Immediate mode shows real-time streaming but may show partial "thinking" text
   * if the model decides to use tools. Buffered mode waits until step-end to ensure
   * only final response text is shown, but has no progressive output.
   * Default: true (immediate streaming)
   */
  immediateTokens?: boolean;
}

/**
 * State for tracking step-based buffering
 */
interface OutputState {
  hasStreamedText: boolean;
  currentStepHasToolCalls: boolean;
  bufferedTextForCurrentStep: string;
  fullText: string;
  /** Track if we've started outputting for current step (for immediate mode) */
  currentStepStartedOutput: boolean;
  /** Track successful tool executions for error recovery detection */
  successfulToolCalls: Array<{ name: string; id: string }>;
}

/**
 * Process a stream event and update state accordingly
 *
 * @param event The stream event to process
 * @param state Current output state
 * @param immediateTokens If true, output tokens immediately; if false, buffer until step-end
 */
const processEvent = (
  event: StreamEvent,
  state: OutputState,
  immediateTokens: boolean
): { newState: OutputState; textToOutput: string | null } => {
  const xmlToolCallPattern = /<(?:function|tool)[^>]*>.*?<\/(?:function|tool)>/gi;

  if (event.type === 'step-start') {
    return {
      newState: {
        ...state,
        currentStepHasToolCalls: false,
        bufferedTextForCurrentStep: '',
        currentStepStartedOutput: false,
        successfulToolCalls: [], // Reset for new step
      },
      textToOutput: null,
    };
  }

  // Track successful tool executions
  if (event.type === 'tool-result') {
    return {
      newState: {
        ...state,
        successfulToolCalls: [...state.successfulToolCalls, { name: event.toolName, id: event.toolCallId }],
      },
      textToOutput: null,
    };
  }

  if (event.type === 'tool-call') {
    // If we were in immediate mode and had started outputting, add newline to separate
    const needsNewline = immediateTokens && state.currentStepStartedOutput;
    return {
      newState: {
        ...state,
        currentStepHasToolCalls: true,
        bufferedTextForCurrentStep: '',
        currentStepStartedOutput: false,
      },
      textToOutput: needsNewline ? '\n' : null,
    };
  }

  if (event.type === 'token' && event.delta) {
    if (immediateTokens && !state.currentStepHasToolCalls) {
      // Immediate mode: output tokens as they arrive (unless tool calls detected)
      return {
        newState: {
          ...state,
          hasStreamedText: true,
          fullText: state.fullText + event.delta,
          currentStepStartedOutput: true,
        },
        textToOutput: event.delta,
      };
    } else {
      // Buffered mode: accumulate for step-end
      return {
        newState: {
          ...state,
          bufferedTextForCurrentStep: state.bufferedTextForCurrentStep + event.delta,
        },
        textToOutput: null,
      };
    }
  }

  if (event.type === 'step-end') {
    // In buffered mode, output accumulated text at step-end
    if (!immediateTokens && !state.currentStepHasToolCalls && state.bufferedTextForCurrentStep) {
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
            currentStepStartedOutput: false,
          },
          textToOutput: filteredText,
        };
      }
    }
    return {
      newState: {
        ...state,
        bufferedTextForCurrentStep: '',
        currentStepStartedOutput: false,
      },
      textToOutput: null,
    };
  }

  if (event.type === 'run-end' && event.result?.content && !state.hasStreamedText) {
    // Fallback: if nothing was streamed, output the final content
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
  const immediateTokens = options?.immediateTokens ?? true; // Default to immediate streaming

  return Effect.gen(function* () {
    // Create state ref for tracking output
    const stateRef = yield* Ref.make<OutputState>({
      hasStreamedText: false,
      currentStepHasToolCalls: false,
      bufferedTextForCurrentStep: '',
      fullText: '',
      currentStepStartedOutput: false,
      successfulToolCalls: [],
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

    // Process stream events using Effect with error recovery
    yield* pipe(
      effectStream,
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(stateRef);
          const { newState, textToOutput } = processEvent(event, currentState, immediateTokens);
          yield* Ref.set(stateRef, newState);

          // Detect stream-error events that occur after tool execution
          if (event.type === 'stream-error' && currentState.successfulToolCalls.length > 0) {
            console.warn(
              `[Fred] Stream error occurred after ${currentState.successfulToolCalls.length} tool(s) executed successfully. ` +
              `Tools: ${currentState.successfulToolCalls.map(t => t.name).join(', ')}. ` +
              `Note: Tool side effects may have persisted despite the error. ` +
              `Error: ${event.error}`
            );
          }

          if (textToOutput) {
            yield* writeText(textToOutput);
          }
        })
      ),
      Stream.runDrain,
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // If stream processing fails, check if tools were executed
          const currentState = yield* Ref.get(stateRef);
          if (currentState.successfulToolCalls.length > 0) {
            console.warn(
              `[Fred] Stream processing failed after ${currentState.successfulToolCalls.length} tool(s) executed successfully. ` +
              `Tools: ${currentState.successfulToolCalls.map(t => t.name).join(', ')}. ` +
              `CRITICAL: Tool side effects may have persisted despite the error. ` +
              `Consider implementing idempotent tools or transaction support.`
            );
          }
          // Re-throw the error
          return Effect.fail(error);
        })
      )
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
