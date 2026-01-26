import { Effect, Stream } from 'effect';
import { LanguageModel, Prompt, Toolkit } from '@effect/ai';
import type {
  StreamEvent,
  TokenEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolErrorEvent,
  UsageEvent,
  MessageEndEvent,
  StreamErrorEvent,
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
  model: any; // AiModel type from @effect/ai
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

  let sequenceCounter = 0;

  // Multi-step streaming with tool execution
  const multiStepEffect = Effect.gen(function* () {
    const eventsList: StreamEvent[] = [];
    let currentMessages = [...messages];
    let stepIndex = 0;

    for (let step = 0; step < config.maxSteps; step++) {
      stepIndex = step;

      // Emit step-start
      eventsList.push(makeStepStartEvent({
        runId,
        threadId,
        stepIndex,
        sequence: sequenceCounter++,
        emittedAt: Date.now(),
      }));

      const initialState: StreamState = {
        sequence: sequenceCounter,
        stepIndex,
        accumulatedText: '',
        toolStarts: new Map(),
        pendingToolCalls: [],
      };

      // Create proper prompt structure using Prompt.make
      const prompt = Prompt.make(currentMessages);

      // Stream the model response for this step
      let finalState: StreamState = initialState;
      try {
        // LanguageModel.streamText returns a Stream directly, not an Effect
        const stream = LanguageModel.streamText({
          model: config.model,
          prompt,
          toolkit: config.toolkit,
          maxSteps: 1, // Single step per iteration, we control the loop
          toolChoice: step === 0 ? (config.toolChoice as any) : undefined,
          temperature: config.temperature,
        });

        // Process stream parts and collect events
        yield* Stream.runForEach(stream, (part) => Effect.sync(() => {
          const emittedAt = Date.now();
          const nextState: StreamState = {
            ...finalState,
            toolStarts: new Map(finalState.toolStarts),
            pendingToolCalls: [...finalState.pendingToolCalls],
          };

          // Handle text delta
          const runtimeTextPart = part as { type?: string; text?: string; delta?: string };
          if (runtimeTextPart.type === 'text' && typeof runtimeTextPart.text === 'string') {
            nextState.accumulatedText += runtimeTextPart.text;
            eventsList.push({
              type: 'token',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.stepIndex,
              delta: runtimeTextPart.text,
              accumulated: nextState.accumulatedText,
            } as TokenEvent);
          }

          if (part.type === 'text-delta') {
            nextState.accumulatedText += part.delta;
            eventsList.push({
              type: 'token',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.stepIndex,
              delta: part.delta,
              accumulated: nextState.accumulatedText,
            } as TokenEvent);
          }

          // Handle tool call
          if (part.type === 'tool-call') {
            const startedAtPart = Date.now();
            nextState.toolStarts.set(part.id, { toolName: part.name, startedAt: startedAtPart });
            nextState.pendingToolCalls.push({
              id: part.id,
              name: part.name,
              params: part.params as Record<string, unknown>,
            });
            eventsList.push({
              type: 'tool-call',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.stepIndex,
              toolCallId: part.id,
              toolName: part.name,
              input: part.params as Record<string, unknown>,
              startedAt: startedAtPart,
            } as ToolCallEvent);
          }

          // Handle finish
          if (part.type === 'finish') {
            nextState.finishReason = part.reason;
            nextState.usage = {
              inputTokens: part.usage.inputTokens,
              outputTokens: part.usage.outputTokens,
              totalTokens: part.usage.totalTokens,
            };
            eventsList.push({
              type: 'usage',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.stepIndex,
              usage: nextState.usage,
            } as UsageEvent);
            eventsList.push({
              type: 'message-end',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.stepIndex,
              finishedAt: emittedAt,
              finishReason: part.reason,
            } as MessageEndEvent);
          }

          sequenceCounter = nextState.sequence;
          finalState = nextState;
        }));
      } catch (error) {
        // Emit stream-error event for fatal failures
        const errorMessage = error instanceof Error ? error.message : String(error);
        eventsList.push(makeStreamErrorEvent({
          runId,
          threadId,
          stepIndex,
          messageId,
          error: errorMessage,
          partialText: finalState.accumulatedText,
          sequence: sequenceCounter++,
          emittedAt: Date.now(),
        }));

        return Stream.fromIterable(eventsList);
      }

      // Emit step-end (end of model stream)
      eventsList.push(makeStepEndEvent({
        runId,
        threadId,
        stepIndex,
        sequence: sequenceCounter++,
        emittedAt: Date.now(),
      }));

      // Check if there are tool calls to execute
      const pendingToolCalls = finalState.pendingToolCalls;

      if (pendingToolCalls.length === 0) {
        // No tool calls - we're done
        break;
      }

      // Execute tools sequentially and build messages for next step
      const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
      if (finalState.accumulatedText) {
        assistantParts.push(Prompt.makePart('text', { text: finalState.accumulatedText }));
      }

      const toolResultMessages: Prompt.MessageEncoded[] = [];

      for (const toolCall of pendingToolCalls) {
        // Add tool call to assistant message
        assistantParts.push(Prompt.makePart('tool-call', {
          id: toolCall.id,
          name: toolCall.name,
          params: toolCall.params,
          providerExecuted: false,
        }));

        // Execute the tool
        const executor = config.toolHandlers?.get(toolCall.name);
        let toolResult: unknown;
        let toolError: Error | undefined;
        const toolStartTime = Date.now();

        if (executor) {
          try {
            toolResult = yield* Effect.tryPromise({
              try: () => Promise.resolve(executor(toolCall.params as Record<string, any>)),
              catch: (err) => err instanceof Error ? err : new Error(String(err)),
            });
          } catch (err) {
            toolError = err instanceof Error ? err : new Error(String(err));
            toolResult = `Error: ${toolError.message}`;
          }
        } else {
          toolResult = `Error: Tool "${toolCall.name}" not found`;
          toolError = new Error(`Tool "${toolCall.name}" not found`);
        }

        const toolCompletedAt = Date.now();
        const durationMs = toolCompletedAt - toolStartTime;

        // Emit tool-result or tool-error event
        if (toolError) {
          eventsList.push({
            type: 'tool-error',
            sequence: sequenceCounter++,
            emittedAt: toolCompletedAt,
            runId,
            threadId,
            messageId,
            step: stepIndex,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            error: {
              message: toolError.message,
              name: toolError.name,
              stack: toolError.stack,
            },
            completedAt: toolCompletedAt,
            durationMs,
          } as ToolErrorEvent);
        } else {
          eventsList.push({
            type: 'tool-result',
            sequence: sequenceCounter++,
            emittedAt: toolCompletedAt,
            runId,
            threadId,
            messageId,
            step: stepIndex,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            output: toolResult,
            completedAt: toolCompletedAt,
            durationMs,
          } as ToolResultEvent);
        }

        // Add tool result message (include isFailure for errors)
        toolResultMessages.push({
          role: 'tool',
          content: [
            Prompt.makePart('tool-result', {
              id: toolCall.id,
              name: toolCall.name,
              result: toolResult,
              isFailure: !!toolError,
              providerExecuted: false,
            }),
          ],
        });
      }

      // Emit step-complete (after tool execution)
      eventsList.push(makeStepCompleteEvent({
        runId,
        threadId,
        stepIndex,
        sequence: sequenceCounter++,
        emittedAt: Date.now(),
      }));

      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: assistantParts,
      });

      // Add tool result messages
      currentMessages.push(...toolResultMessages);
    }

    return Stream.fromIterable(eventsList);
  });

  return Stream.unwrap(multiStepEffect);
};
