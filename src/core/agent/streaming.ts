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
  toolkit?: Toolkit.Service;
  toolHandlers?: Map<string, (args: Record<string, any>) => Promise<any> | any>;
  maxSteps: number;
  toolChoice?: 'auto' | 'required' | { name: string };
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
              'error' in res ? res : { error: undefined, result: res }
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
        pendingToolCalls: [...state.pendingToolCalls, {
          id: part.id,
          name: part.name,
          params: part.params as Record<string, unknown>,
        }],
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
 * Stream multi-step agent responses with real-time event emission.
 *
 * Uses Effect's Stream.async for real-time streaming with proper
 * functional composition and error handling throughout.
 */
export const streamMultiStep = (
  initialMessages: Array<Prompt.MessageEncoded | any>,
  config: MultiStepConfig,
  options: {
    runId: string;
    threadId?: string;
    messageId: string;
  }
): Stream.Stream<StreamEvent, Error> => {
  const { runId, threadId, messageId } = options;
  const messages = normalizeMessages(initialMessages);

  // Use Stream.async for real-time event emission
  return Stream.async<StreamEvent, Error>((emit) => {
    let sequenceCounter = 0;

    // Helper to emit an event
    const emitEvent = (event: StreamEvent) => {
      emit.single(event);
    };

    // Run the multi-step process using Effect
    const runMultiStep = Effect.gen(function* () {
      let currentMessages = [...messages];

      for (let stepIndex = 0; stepIndex < config.maxSteps; stepIndex++) {
        // Emit step-start immediately
        emitEvent(makeStepStartEvent({
          runId,
          threadId,
          stepIndex,
          sequence: sequenceCounter++,
          emittedAt: Date.now(),
        }));

        // Initialize state for this step
        let state: StreamState = {
          sequence: sequenceCounter,
          stepIndex,
          accumulatedText: '',
          toolStarts: new Map(),
          pendingToolCalls: [],
        };

        // Create prompt and stream model response
        const prompt = Prompt.make(currentMessages);
        const modelStream = LanguageModel.streamText({
          model: config.model,
          prompt,
          toolkit: config.toolkit,
          maxSteps: 1,
          toolChoice: stepIndex === 0 ? (config.toolChoice as any) : undefined,
          temperature: config.temperature,
        });

        // Process model stream, emitting events in real-time
        yield* Stream.runForEach(modelStream, (part) =>
          Effect.sync(() => {
            const { event, newState } = processStreamPart(
              part,
              state,
              runId,
              threadId,
              messageId
            );
            state = newState;
            sequenceCounter = state.sequence;

            if (event) {
              emitEvent(event);
            }
          })
        );

        // Emit message-end if we had a finish
        if (state.finishReason) {
          emitEvent({
            type: 'message-end',
            sequence: sequenceCounter++,
            emittedAt: Date.now(),
            runId,
            threadId,
            messageId,
            step: stepIndex,
            finishedAt: Date.now(),
            finishReason: state.finishReason,
          } as MessageEndEvent);
        }

        // Emit step-end
        emitEvent(makeStepEndEvent({
          runId,
          threadId,
          stepIndex,
          sequence: sequenceCounter++,
          emittedAt: Date.now(),
        }));

        // Check for tool calls
        if (state.pendingToolCalls.length === 0) {
          // No tool calls - we're done
          break;
        }

        // Execute tools and emit results in real-time
        const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
        if (state.accumulatedText) {
          assistantParts.push(Prompt.makePart('text', { text: state.accumulatedText }));
        }

        const toolResultMessages: Prompt.MessageEncoded[] = [];

        // Process each tool call using Effect
        for (const toolCall of state.pendingToolCalls) {
          assistantParts.push(Prompt.makePart('tool-call', {
            id: toolCall.id,
            name: toolCall.name,
            params: toolCall.params,
            providerExecuted: false,
          }));

          // Execute tool using Effect
          const { event, result, isError } = yield* executeToolEffect(
            toolCall,
            config.toolHandlers,
            runId,
            threadId,
            messageId,
            stepIndex,
            sequenceCounter++
          );

          // Emit tool result/error immediately
          emitEvent(event);

          toolResultMessages.push({
            role: 'tool',
            content: [
              Prompt.makePart('tool-result', {
                id: toolCall.id,
                name: toolCall.name,
                result,
                isFailure: isError,
                providerExecuted: false,
              }),
            ],
          });
        }

        // Emit step-complete
        emitEvent(makeStepCompleteEvent({
          runId,
          threadId,
          stepIndex,
          sequence: sequenceCounter++,
          emittedAt: Date.now(),
        }));

        // Build messages for next step
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: assistantParts },
          ...toolResultMessages,
        ];
      }
    });

    // Run the effect and handle completion/errors
    Effect.runPromise(runMultiStep)
      .then(() => emit.end())
      .catch((error) => emit.fail(error instanceof Error ? error : new Error(String(error))));
  });
};
