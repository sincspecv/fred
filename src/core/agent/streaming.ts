/**
 * Multi-step agent streaming with tool execution
 *
 * IMPORTANT: Tool Execution Timing and Error Recovery
 *
 * Tools execute immediately after the model produces tool-call parts, BEFORE
 * the full response is validated. This provides real-time tool execution for
 * responsive multi-step agentic flows, but creates a potential atomicity issue:
 *
 * 1. Model streams response with tool-call parts
 * 2. Tools execute (side effects committed to database, APIs, etc.)
 * 3. Tool results added to conversation history
 * 4. Stream continues or completes
 * 5. Response validation happens (in @effect/ai or downstream)
 * 6. If validation fails → Error bubbles up BUT tools already executed
 *
 * This means: User sees error, but tool side effects persisted.
 *
 * Mitigation Strategies:
 *
 * 1. **Idempotent Tools**: Design tools to be safely retriable
 *    - Check if operation already completed before executing
 *    - Use unique request IDs to prevent duplicate operations
 *
 * 2. **Read-Only Tools**: Prefer read-only tools where possible
 *    - Query operations have no side effects
 *    - Safe to execute multiple times
 *
 * 3. **Transaction Support** (future):
 *    - Implement two-phase commit for database tools
 *    - Tools return prepare() → commit() handles
 *    - Only commit after validation succeeds
 *
 * 4. **Error Recovery**: The streamOutput utility detects this situation
 *    and logs a warning when stream processing fails after tool execution
 *
 * See: FRED_IMPROVEMENTS.md in client projects for detailed analysis
 */

import { Effect, Stream, pipe } from 'effect';
import { LanguageModel, Prompt, Toolkit } from '@effect/ai';
import type {
  StreamEvent,
  TokenEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolErrorEvent,
  UsageEvent,
  MessageEndEvent,
} from '../stream/events';
import {
  makeStepStartEvent,
  makeStepEndEvent,
  makeStepCompleteEvent,
  makeStreamErrorEvent,
} from '../stream/events';
import { normalizeMessages } from '../messages';

export interface MultiStepConfig {
  /** The AiModel to use for streaming */
  model: any;
  toolkit?: any;
  toolHandlers?: Map<string, (args: Record<string, any>) => Promise<any> | any>;
  maxSteps: number;
  // Accept any tool choice format - internal handling casts appropriately
  toolChoice?: 'auto' | 'required' | 'none' | { name: string } | { type: 'tool'; toolName: string };
  temperature?: number;
}

export interface MultiStepState {
  stepIndex: number;
  messages: Prompt.MessageEncoded[];
  accumulatedText: string;
  pendingToolCalls?: Array<{
    id: string;
    name: string;
    params: Record<string, unknown>;
  }>;
}

interface StreamState {
  sequence: number;
  stepIndex: number;
  accumulatedText: string;
  toolStarts: Map<string, { toolName: string; startedAt: number }>;
  pendingToolCalls: Array<{
    id: string;
    name: string;
    params: Record<string, unknown>;
  }>;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface ToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

/**
 * Execute a single tool and return the result event
 */
const executeToolEffect = (
  toolCall: ToolCall,
  toolHandlers: Map<string, (args: Record<string, any>) => Promise<any> | any> | undefined,
  runId: string,
  threadId: string | undefined,
  messageId: string,
  stepIndex: number,
  sequence: number
): Effect.Effect<{ event: ToolResultEvent | ToolErrorEvent; result: unknown; isError: boolean }, never> =>
  Effect.gen(function* () {
    const executor = toolHandlers?.get(toolCall.name);
    const toolStartTime = Date.now();

    const result = yield* (
      executor
        ? Effect.tryPromise({
            try: () => Promise.resolve(executor(toolCall.params as Record<string, any>)),
            catch: (err) => err instanceof Error ? err : new Error(String(err)),
          }).pipe(
            Effect.catchAll((err) =>
              Effect.succeed({ error: err, result: `Error: ${err.message}` })
            ),
            Effect.map((res) =>
              typeof res === 'object' && res !== null && 'error' in res ? res : { error: undefined, result: res }
            )
          )
        : Effect.succeed({
            error: new Error(`Tool "${toolCall.name}" not found`),
            result: `Error: Tool "${toolCall.name}" not found`,
          })
    );

    const toolCompletedAt = Date.now();
    const durationMs = toolCompletedAt - toolStartTime;

    if (result.error) {
      const event: ToolErrorEvent = {
        type: 'tool-error',
        sequence,
        emittedAt: toolCompletedAt,
        runId,
        threadId,
        messageId,
        step: stepIndex,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: {
          message: result.error.message,
          name: result.error.name,
          stack: result.error.stack,
        },
        completedAt: toolCompletedAt,
        durationMs,
      };
      return { event, result: result.result, isError: true };
    }

    const event: ToolResultEvent = {
      type: 'tool-result',
      sequence,
      emittedAt: toolCompletedAt,
      runId,
      threadId,
      messageId,
      step: stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: result.result,
      completedAt: toolCompletedAt,
      durationMs,
    };
    return { event, result: result.result, isError: false };
  });

/**
 * Process a single model stream part and return corresponding event
 */
const processStreamPart = (
  part: any,
  state: StreamState,
  runId: string,
  threadId: string | undefined,
  messageId: string
): { event: StreamEvent | null; newState: StreamState } => {
  const emittedAt = Date.now();

  // Handle text delta
  if (part.type === 'text' && typeof part.text === 'string') {
    const newAccumulated = state.accumulatedText + part.text;
    const event: TokenEvent = {
      type: 'token',
      sequence: state.sequence,
      emittedAt,
      runId,
      threadId,
      messageId,
      step: state.stepIndex,
      delta: part.text,
      accumulated: newAccumulated,
    };
    return {
      event,
      newState: { ...state, accumulatedText: newAccumulated, sequence: state.sequence + 1 },
    };
  }

  if (part.type === 'text-delta') {
    const newAccumulated = state.accumulatedText + part.delta;
    const event: TokenEvent = {
      type: 'token',
      sequence: state.sequence,
      emittedAt,
      runId,
      threadId,
      messageId,
      step: state.stepIndex,
      delta: part.delta,
      accumulated: newAccumulated,
    };
    return {
      event,
      newState: { ...state, accumulatedText: newAccumulated, sequence: state.sequence + 1 },
    };
  }

  // Handle tool call
  if (part.type === 'tool-call') {
    const startedAt = Date.now();
    const event: ToolCallEvent = {
      type: 'tool-call',
      sequence: state.sequence,
      emittedAt,
      runId,
      threadId,
      messageId,
      step: state.stepIndex,
      toolCallId: part.id,
      toolName: part.name,
      input: part.params as Record<string, unknown>,
      startedAt,
    };
    const newToolStarts = new Map(state.toolStarts);
    newToolStarts.set(part.id, { toolName: part.name, startedAt });
    return {
      event,
      newState: {
        ...state,
        sequence: state.sequence + 1,
        toolStarts: newToolStarts,
      },
    };
  }

  // Handle tool-result (from @effect/ai automatic execution)
  if (part.type === 'tool-result') {
    const toolStart = state.toolStarts.get(part.id);
    const completedAt = Date.now();
    const durationMs = toolStart ? completedAt - toolStart.startedAt : 0;

    const event: ToolResultEvent = {
      type: 'tool-result',
      sequence: state.sequence,
      emittedAt: completedAt,
      runId,
      threadId,
      messageId,
      step: state.stepIndex,
      toolCallId: part.id,
      toolName: part.name,
      output: part.result,
      completedAt,
      durationMs,
    };

    return {
      event,
      newState: {
        ...state,
        sequence: state.sequence + 1,
      },
    };
  }

  // Handle finish
  if (part.type === 'finish') {
    const usage = {
      inputTokens: part.usage.inputTokens,
      outputTokens: part.usage.outputTokens,
      totalTokens: part.usage.totalTokens,
    };
    const event: UsageEvent = {
      type: 'usage',
      sequence: state.sequence,
      emittedAt,
      runId,
      threadId,
      messageId,
      step: state.stepIndex,
      usage,
    };
    return {
      event,
      newState: {
        ...state,
        sequence: state.sequence + 1,
        finishReason: part.reason,
        usage,
      },
    };
  }

  return { event: null, newState: state };
};

/**
 * Stream a single step and return events plus final state
 */
const streamSingleStep = (
  currentMessages: Prompt.MessageEncoded[],
  config: MultiStepConfig,
  stepIndex: number,
  sequenceStart: number,
  runId: string,
  threadId: string | undefined,
  messageId: string
): Stream.Stream<StreamEvent, Error, any> => {
  return Stream.unwrap(
    Effect.gen(function* () {
      let state: StreamState = {
        sequence: sequenceStart + 1, // +1 because step-start uses sequenceStart
        stepIndex,
        accumulatedText: '',
        toolStarts: new Map(),
        pendingToolCalls: [],
      };

      // Step-start event
      const stepStartEvent = makeStepStartEvent({
        runId,
        threadId,
        stepIndex,
        sequence: sequenceStart,
        emittedAt: Date.now(),
      });

      // Create prompt and get model stream
      const prompt = Prompt.make(currentMessages);
      // Cast options via unknown to satisfy TypeScript - the runtime types are correct
      const streamOptions = {
        model: config.model,
        prompt,
        toolkit: config.toolkit,
        maxSteps: 1,
        toolChoice: stepIndex === 0 ? (config.toolChoice as any) : undefined,
        temperature: config.temperature,
      } as unknown as Parameters<typeof LanguageModel.streamText>[0];
      const modelStream = LanguageModel.streamText(streamOptions);

      // Transform model stream to our events, tracking state
      const eventStream = pipe(
        modelStream,
        Stream.map((part) => {
          const { event, newState } = processStreamPart(part, state, runId, threadId, messageId);
          state = newState;
          return event;
        }),
        Stream.filter((event): event is StreamEvent => event !== null)
      );

      // After model stream completes, emit step-end and capture final state
      const stepEndStream = Stream.fromEffect(
        Effect.sync(() => {
          const events: StreamEvent[] = [];

          // Message-end if we had a finish
          if (state.finishReason) {
            events.push({
              type: 'message-end',
              sequence: state.sequence++,
              emittedAt: Date.now(),
              runId,
              threadId,
              messageId,
              step: stepIndex,
              finishedAt: Date.now(),
              finishReason: state.finishReason,
            } as MessageEndEvent);
          }

          // Step-end
          events.push(makeStepEndEvent({
            runId,
            threadId,
            stepIndex,
            sequence: state.sequence++,
            emittedAt: Date.now(),
          }));

          return { events, finalState: state };
        })
      ).pipe(
        Stream.flatMap(({ events, finalState }) => {
          // Store final state for caller to access
          (stepEndStream as any).__finalState = finalState;
          return Stream.fromIterable(events);
        })
      );

      // Combine: step-start, model events, step-end
      return pipe(
        Stream.make(stepStartEvent),
        Stream.concat(eventStream),
        Stream.concat(stepEndStream)
      );
    })
  );
};

/**
 * Stream multi-step agent responses with real-time event emission.
 *
 * Hybrid approach:
 * - Manual multi-step recursion for proper event emission
 * - @effect/ai handles tool execution (via toolkit + toolLayer)
 * - We capture tool results and build conversation history
 */
export const streamMultiStep = (
  initialMessages: Array<Prompt.MessageEncoded | any>,
  config: MultiStepConfig,
  options: {
    runId: string;
    threadId?: string;
    messageId: string;
  }
): Stream.Stream<StreamEvent, Error, any> => {
  const { runId, threadId, messageId } = options;
  const messages = normalizeMessages(initialMessages);

  // Track tool calls and results per step
  interface StepToolInfo {
    toolCalls: Array<{ id: string; name: string; params: Record<string, unknown> }>;
    toolResults: Map<string, any>;
  }

  const createStepStream = (
    currentMessages: Prompt.MessageEncoded[],
    stepIndex: number,
    sequenceStart: number
  ): Stream.Stream<StreamEvent, Error, any> => {
    if (stepIndex >= config.maxSteps) {
      return Stream.empty;
    }

    return Stream.unwrap(
      Effect.gen(function* () {
        let state: StreamState = {
          sequence: sequenceStart + 1,
          stepIndex,
          accumulatedText: '',
          toolStarts: new Map(),
          pendingToolCalls: [],
        };

        const stepToolInfo: StepToolInfo = {
          toolCalls: [],
          toolResults: new Map(),
        };

        // Step-start event - CRITICAL for output.ts to reset currentStepHasToolCalls
        const stepStartEvent = makeStepStartEvent({
          runId,
          threadId,
          stepIndex,
          sequence: sequenceStart,
          emittedAt: Date.now(),
        });

        // Create prompt and get model stream
        // @effect/ai executes tools automatically with maxSteps: 1
        const prompt = Prompt.make(currentMessages);
        // Cast options via unknown to satisfy TypeScript - the runtime types are correct
        const streamOptions = {
          model: config.model,
          prompt,
          toolkit: config.toolkit,
          maxSteps: 1, // One model call per step - @effect/ai handles tool execution
          toolChoice: stepIndex === 0 ? (config.toolChoice as any) : undefined,
          temperature: config.temperature,
        } as unknown as Parameters<typeof LanguageModel.streamText>[0];
        const modelStream = LanguageModel.streamText(streamOptions);

        // Transform model stream, capturing tool calls and results
        const eventStream = pipe(
          modelStream,
          Stream.map((part) => {
            // Cast part to any for type checks - toolkit parts may include tool-call/tool-result
            const typedPart = part as { type: string; id?: string; name?: string; params?: unknown; result?: unknown };

            // Capture tool calls
            if (typedPart.type === 'tool-call') {
              stepToolInfo.toolCalls.push({
                id: typedPart.id!,
                name: typedPart.name!,
                params: typedPart.params as Record<string, unknown>,
              });
            }

            // Capture tool results from @effect/ai execution
            if (typedPart.type === 'tool-result') {
              stepToolInfo.toolResults.set(typedPart.id!, typedPart.result);
            }

            const { event, newState } = processStreamPart(part, state, runId, threadId, messageId);
            state = newState;
            return event;
          }),
          Stream.filter((event): event is StreamEvent => event !== null)
        );

        // After model stream, decide if we continue
        const postStepStream = Stream.fromEffect(
          Effect.sync(() => {
            const events: StreamEvent[] = [];

            // Message-end if we had a finish
            if (state.finishReason) {
              events.push({
                type: 'message-end',
                sequence: state.sequence++,
                emittedAt: Date.now(),
                runId,
                threadId,
                messageId,
                step: stepIndex,
                finishedAt: Date.now(),
                finishReason: state.finishReason,
              } as MessageEndEvent);
            }

            return { events, stepToolInfo, finalState: state };
          })
        ).pipe(
          Stream.flatMap(({ events, stepToolInfo, finalState }) =>
            Stream.unwrap(
              Effect.sync(() => {
                // No tool calls - we're done
                if (stepToolInfo.toolCalls.length === 0) {
                  return Stream.fromIterable(events);
                }

                // Build conversation history with tool calls and results
                const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];

                // Add text if present
                if (finalState.accumulatedText.trim()) {
                  assistantParts.push(Prompt.makePart('text', { text: finalState.accumulatedText }));
                }

                // Add tool calls
                for (const toolCall of stepToolInfo.toolCalls) {
                  assistantParts.push(
                    Prompt.makePart('tool-call', {
                      id: toolCall.id,
                      name: toolCall.name,
                      params: toolCall.params,
                      providerExecuted: false, // Match original streaming.ts
                    })
                  );
                }

                // Build tool result messages
                const toolResultMessages: Prompt.MessageEncoded[] = [];
                for (const toolCall of stepToolInfo.toolCalls) {
                  const result = stepToolInfo.toolResults.get(toolCall.id);

                  toolResultMessages.push({
                    role: 'tool',
                    content: [
                      Prompt.makePart('tool-result', {
                        id: toolCall.id,
                        name: toolCall.name,
                        result,
                        isFailure: false,
                        providerExecuted: false,
                      }),
                    ],
                  });
                }

                // Build next messages with assistant message (if has parts) and tool results
                const nextMessages = [...currentMessages];

                // MUST include assistant message with tool calls (Anthropic API requirement)
                // Tool results must be preceded by assistant message containing tool calls
                if (assistantParts.length > 0) {
                  nextMessages.push({ role: 'assistant' as const, content: assistantParts });
                  nextMessages.push(...toolResultMessages);
                } else {
                  // This shouldn't happen - if we have tool calls, assistantParts should have them
                  return Stream.fromIterable(events);
                }

                // Continue to next step
                return pipe(
                  Stream.fromIterable(events),
                  Stream.concat(createStepStream(nextMessages, stepIndex + 1, finalState.sequence))
                );
              })
            )
          )
        );

        // Combine: step-start, model events, post-step handling
        return pipe(
          Stream.make(stepStartEvent),
          Stream.concat(eventStream),
          Stream.concat(postStepStream)
        );
      })
    );
  };

  return createStepStream([...messages], 0, 0);
};
