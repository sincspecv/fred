import { Context, Effect, Stream, Ref } from 'effect';
import { Prompt } from '@effect/ai';
import type { AgentMessage, AgentResponse } from '../agent/agent';
import type { StreamEvent } from '../stream/events';
import { SpanKind } from '../tracing/types';
import { validateMessageLength } from '../../utils/validation';
import { semanticMatch } from '../../utils/semantic';
import {
  createStreamIdGenerator,
  generateSyntheticStreamEvents,
} from './stream-events';
import { makeHandoffStartEvent, type RunEndEvent, type HandoffStartEvent } from '../stream/events';
import { createStreamResultFromIterable, type StreamResult } from '../stream/result';
import type {
  RouteResult,
  ProcessingOptions,
  MessageProcessorDeps,
  SemanticMatcherFn,
} from './types';

/**
 * MessageProcessor handles routing and processing of user messages.
 * Extracts the core message handling logic from Fred class.
 */
export class MessageProcessor {
  private deps: MessageProcessorDeps;

  constructor(deps: MessageProcessorDeps) {
    this.deps = deps;
  }

  /**
   * Update dependencies (called when Fred's internal state changes)
   */
  updateDeps(partial: Partial<MessageProcessorDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  /**
   * Get current dependencies (for testing)
   */
  getDeps(): MessageProcessorDeps {
    return this.deps;
  }

  /**
   * Route a message to the appropriate handler
   * Returns routing result with agent, pipeline, or intent information
   */
  async routeMessage(
    message: string,
    semanticMatcher?: SemanticMatcherFn,
    previousMessages: AgentMessage[] = [],
    options?: { conversationId?: string; sequentialVisibility?: boolean }
  ): Promise<RouteResult> {
    const {
      contextManager,
      agentManager,
      pipelineManager,
      intentMatcher,
      intentRouter,
      tracer,
      messageRouter,
      defaultAgentId,
    } = this.deps;

    const conversationId = options?.conversationId;
    const sequentialVisibility = options?.sequentialVisibility ?? true;

    // Routing priority: 1. Agent utterances, 2. Pipeline utterances, 3. Intent matching, 4. Default agent
    // Create span for routing
    const routingSpan = tracer?.startSpan('routing', {
      kind: SpanKind.INTERNAL,
    });

    if (routingSpan) {
      tracer?.setActiveSpan(routingSpan);
    }

    try {
      // If MessageRouter is configured, use rule-based routing
      if (messageRouter) {
        const decision = await Effect.runPromise(messageRouter.route(message, {}));

        if (routingSpan) {
          routingSpan.setAttributes({
            'routing.method': decision.fallback ? 'message.router.fallback' : 'message.router.rule',
            'routing.agentId': decision.agent,
            'routing.fallback': decision.fallback,
          });
          if (decision.rule) {
            routingSpan.setAttribute('routing.ruleId', decision.rule.id);
          }
          if (decision.matchType) {
            routingSpan.setAttribute('routing.matchType', decision.matchType);
          }
        }

        const agent = agentManager.getAgent(decision.agent);
        if (agent) {
          if (routingSpan) {
            routingSpan.setStatus('ok');
          }
          return {
            type: decision.fallback ? 'default' : 'agent',
            agent,
            agentId: decision.agent,
          };
        } else {
          // Agent not found - this shouldn't happen if fallback works correctly
          if (routingSpan) {
            routingSpan.addEvent('agent.notFound', { 'agent.id': decision.agent });
            routingSpan.setStatus('error', `Agent ${decision.agent} not found`);
          }
          return { type: 'none' };
        }
      }

      // Otherwise, use existing routing (agent utterances, pipelines, intents)
      // Check agent utterances first (direct routing)
      const agentMatch = await agentManager.matchAgentByUtterance(message, semanticMatcher);

      if (agentMatch) {
        if (routingSpan) {
          routingSpan.setAttributes({
            'routing.method': 'agent.utterance',
            'routing.agentId': agentMatch.agentId,
            'routing.confidence': agentMatch.confidence,
            'routing.matchType': agentMatch.matchType,
          });
        }

        // Route directly to matched agent
        const agent = agentManager.getAgent(agentMatch.agentId);
        if (agent) {
          if (routingSpan) {
            routingSpan.setStatus('ok');
          }
          return {
            type: 'agent',
            agent,
            agentId: agentMatch.agentId,
          };
        } else {
          // Agent not found, fall through to pipeline matching
          if (routingSpan) {
            routingSpan.addEvent('agent.notFound', { 'agent.id': agentMatch.agentId });
          }
        }
      }

      // If no agent match, check pipeline utterances
      if (!agentMatch || (agentMatch && !agentManager.getAgent(agentMatch.agentId))) {
        const pipelineMatch = await pipelineManager.matchPipelineByUtterance(message, semanticMatcher);

        if (pipelineMatch) {
          if (routingSpan) {
            routingSpan.setAttributes({
              'routing.method': 'pipeline.utterance',
              'routing.pipelineId': pipelineMatch.pipelineId,
              'routing.confidence': pipelineMatch.confidence,
              'routing.matchType': pipelineMatch.matchType,
            });
          }

          // Create span for pipeline execution
          const pipelineSpan = tracer?.startSpan('pipeline.process', {
            kind: SpanKind.INTERNAL,
            attributes: {
              'pipeline.id': pipelineMatch.pipelineId,
              'pipeline.matchType': pipelineMatch.matchType,
              'pipeline.confidence': pipelineMatch.confidence,
            },
          });

          const previousPipelineSpan = tracer?.getActiveSpan();
          if (pipelineSpan) {
            tracer?.setActiveSpan(pipelineSpan);
          }

          try {
            const response = await pipelineManager.executePipeline(
              pipelineMatch.pipelineId,
              message,
              previousMessages,
              {
                conversationId,
                sequentialVisibility,
              }
            );
            if (pipelineSpan) {
              pipelineSpan.setAttribute('response.length', response.content.length);
              pipelineSpan.setAttribute('response.hasToolCalls', (response.toolCalls?.length ?? 0) > 0);
              pipelineSpan.setStatus('ok');
            }
            if (routingSpan) {
              routingSpan.setStatus('ok');
            }
            return {
              type: 'pipeline',
              pipelineId: pipelineMatch.pipelineId,
              response,
            };
          } catch (error) {
            if (pipelineSpan && error instanceof Error) {
              pipelineSpan.recordException(error);
              pipelineSpan.setStatus('error', error.message);
            }
            throw error;
          } finally {
            pipelineSpan?.end();
            if (previousPipelineSpan) {
              tracer?.setActiveSpan(previousPipelineSpan);
            }
          }
        } else {
          // No pipeline match, try intent matching
          const match = await Effect.runPromise(
            intentMatcher.matchIntent(message, semanticMatcher).pipe(
              Effect.catchTag('IntentMatchError', () => Effect.succeed(null))
            )
          );

          if (match) {
            if (routingSpan) {
              routingSpan.setAttributes({
                'routing.method': 'intent.matching',
                'routing.intentId': match.intent.id,
                'routing.confidence': match.confidence,
                'routing.matchType': match.matchType,
              });
            }

            // Route to matched intent's action
            if (match.intent.action.type === 'agent') {
              const agent = agentManager.getAgent(match.intent.action.target);
              if (agent) {
                if (routingSpan) {
                  routingSpan.setStatus('ok');
                }
                return {
                  type: 'agent',
                  agent,
                  agentId: match.intent.action.target,
                };
              }
            } else {
              // Intent routes to pipeline - execute and return response
              const response = await Effect.runPromise(intentRouter.routeIntent(match, message)) as AgentResponse;
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'intent',
                response,
              };
            }
          } else if (defaultAgentId) {
            if (routingSpan) {
              routingSpan.setAttributes({
                'routing.method': 'default.agent',
                'routing.defaultAgentId': defaultAgentId,
              });
            }
            // No intent matched - route to default agent
            const agent = agentManager.getAgent(defaultAgentId);
            if (agent) {
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'default',
                agent,
                agentId: defaultAgentId,
              };
            }
          }
        }
      }

      // No match and no default agent
      if (routingSpan) {
        routingSpan.setStatus('error', 'No routing target found');
      }
      return { type: 'none' };
    } catch (error) {
      if (routingSpan && error instanceof Error) {
        routingSpan.recordException(error);
        routingSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      routingSpan?.end();
    }
  }

  /**
   * Process a user message through the intent system
   */
  async processMessage(
    message: string,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    const {
      contextManager,
      agentManager,
      tracer,
      memoryDefaults,
    } = this.deps;

    // Validate message input to prevent resource exhaustion
    validateMessageLength(message);

    // Create root span for message processing
    const rootSpan = tracer?.startSpan('processMessage', {
      kind: SpanKind.SERVER,
      attributes: {
        'message.length': message.length,
        'options.useSemanticMatching': options?.useSemanticMatching ?? true,
        'options.semanticThreshold': options?.semanticThreshold ?? 0.6,
      },
    });

    const previousActiveSpan = tracer?.getActiveSpan();
    if (rootSpan) {
      tracer?.setActiveSpan(rootSpan);
    }

    try {
      const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
      const conversationId = options?.conversationId
        ? options.conversationId
        : requireConversationId
          ? undefined
          : contextManager.generateConversationId();
      const useSemantic = options?.useSemanticMatching ?? true;
      const threshold = options?.semanticThreshold ?? 0.6;

      if (!conversationId) {
        throw new Error('Conversation ID is required for this request');
      }

      if (rootSpan) {
        rootSpan.setAttribute('conversation.id', conversationId);
      }

      // Get conversation history (already in Prompt message format)
      const history = await contextManager.getHistory(conversationId);

      // Filter to user/assistant messages for agent processing
      // Since AgentMessage is Prompt message-encoded, we can use history directly
      const previousMessages: AgentMessage[] = history.filter(
        msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
      ) as AgentMessage[];

      // Create semantic matcher if enabled
      const semanticMatcher = useSemantic
        ? async (msg: string, utterances: string[]) => {
            return semanticMatch(msg, utterances, threshold);
          }
        : undefined;

      // Route message to appropriate handler
      const sequentialVisibility = options?.sequentialVisibility ?? memoryDefaults.sequentialVisibility ?? true;
      const route = await this.routeMessage(
        message,
        semanticMatcher,
        sequentialVisibility ? previousMessages : [],
        { conversationId, sequentialVisibility }
      );

      let response: AgentResponse;
      let usedAgentId: string | null = null;

      // Handle routing result
      if (route.type === 'none') {
        return null;
      }

      if (route.type === 'pipeline' || route.type === 'intent') {
        // Pipeline or intent already executed, use the response
        if (!route.response) {
          throw new Error(`Route type ${route.type} did not return a response`);
        }
        response = route.response;
      } else if (route.type === 'agent' || route.type === 'default') {
        // Agent routing - need to execute
        if (!route.agent) {
          throw new Error(`Route type ${route.type} did not return an agent`);
        }
        usedAgentId = route.agentId || null;

        // Create span for agent execution
        const agentSpan = tracer?.startSpan('agent.process', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'agent.id': route.agentId || 'unknown',
          },
        });

        const previousAgentSpan = tracer?.getActiveSpan();
        if (agentSpan) {
          tracer?.setActiveSpan(agentSpan);
        }

        try {
          response = await route.agent.processMessage(
            message,
            sequentialVisibility ? previousMessages : []
          );
          if (agentSpan) {
            agentSpan.setAttribute('response.length', response.content.length);
            agentSpan.setAttribute('response.hasToolCalls', (response.toolCalls?.length ?? 0) > 0);
            agentSpan.setAttribute('response.hasHandoff', response.handoff !== undefined);
            agentSpan.setStatus('ok');
          }
        } catch (error) {
          if (agentSpan && error instanceof Error) {
            agentSpan.recordException(error);
            agentSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
          agentSpan?.end();
          if (previousAgentSpan) {
            tracer?.setActiveSpan(previousAgentSpan);
          }
        }
      } else {
        throw new Error(`Unknown route type: ${route.type}`);
      }

      // Process handoffs recursively (with max depth to prevent infinite loops)
      const maxHandoffDepth = 10;
      let handoffDepth = 0;
      let currentResponse = response;

      while (currentResponse.handoff && handoffDepth < maxHandoffDepth) {
        handoffDepth++;
        const handoff = currentResponse.handoff;

        // Create span for handoff
        const handoffSpan = tracer?.startSpan('agent.handoff', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'handoff.depth': handoffDepth,
            'handoff.fromAgent': currentResponse.handoff?.agentId || 'unknown',
            'handoff.toAgent': handoff.agentId,
            'handoff.hasContext': handoff.context !== undefined,
          },
        });

        const previousHandoffSpan = tracer?.getActiveSpan();
        if (handoffSpan) {
          tracer?.setActiveSpan(handoffSpan);
        }

        try {
          // Get target agent
          const targetAgent = agentManager.getAgent(handoff.agentId);
          if (!targetAgent) {
            // Target agent not found, return current response
            if (handoffSpan) {
              handoffSpan.addEvent('agent.notFound', { 'agent.id': handoff.agentId });
              handoffSpan.setStatus('error', 'Target agent not found');
            }
            break;
          }

          // Prepare handoff message (use provided message or original message)
          const handoffMessage = handoff.message || message;

          // Add context from handoff if provided
          const handoffContext = handoff.context ? `\n\nContext: ${JSON.stringify(handoff.context)}` : '';
          const messageWithContext = handoffMessage + handoffContext;

          // Process message with target agent
          currentResponse = await targetAgent.processMessage(messageWithContext, previousMessages);

          if (handoffSpan) {
            handoffSpan.setAttribute('handoff.response.length', currentResponse.content.length);
            handoffSpan.setStatus('ok');
          }
        } catch (error) {
          if (handoffSpan && error instanceof Error) {
            handoffSpan.recordException(error);
            handoffSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
          handoffSpan?.end();
          if (previousHandoffSpan) {
            tracer?.setActiveSpan(previousHandoffSpan);
          }
        }
      }

      if (handoffDepth >= maxHandoffDepth) {
        console.warn('Maximum handoff depth reached. Stopping handoff chain.');
        if (rootSpan) {
          rootSpan.addEvent('handoff.maxDepthReached', { 'maxDepth': maxHandoffDepth });
        }
      }

      if (rootSpan) {
        rootSpan.setAttributes({
          'response.length': currentResponse.content.length,
          'response.hasToolCalls': (currentResponse.toolCalls?.length ?? 0) > 0,
          'handoff.depth': handoffDepth,
        });
        rootSpan.setStatus('ok');
      }

      // Check if the routed agent allows history persistence (default: true)
      const routedAgent = usedAgentId ? agentManager.getAgent(usedAgentId) : route.agent;
      const shouldPersistHistory = routedAgent?.config.persistHistory !== false;

      if (shouldPersistHistory) {
        // Add user message to context
        const userMessage: Prompt.MessageEncoded = {
          role: 'user',
          content: message,
        };
        await contextManager.addMessage(conversationId, userMessage);

        // Handle tool calls: add them to context for persistence
        // Tools are executed inside the Effect LanguageModel loop, so we don't need to
        // continue the conversation manually. The response is already the final response.
        if (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
          const hasToolResults = currentResponse.toolCalls.some(tc => tc.result !== undefined);

          if (hasToolResults) {
            // Add assistant message with tool calls to context
            // Use toolCalls array in assistant messages for tool results
            const baseTimestamp = Date.now();
            const toolCallIds = currentResponse.toolCalls.map(
              (toolCall, idx) => `call_${toolCall.toolId}_${baseTimestamp}_${idx}`
            );
            const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
            if (currentResponse.content) {
              assistantParts.push(Prompt.makePart('text', { text: currentResponse.content }));
            }
            currentResponse.toolCalls.forEach((toolCall, idx) => {
              assistantParts.push(
                Prompt.makePart('tool-call', {
                  id: toolCallIds[idx],
                  name: toolCall.toolId,
                  params: toolCall.args,
                  providerExecuted: false,
                })
              );
            });
            await contextManager.addMessage(conversationId, {
              role: 'assistant',
              content: assistantParts,
            });

            // Add tool results to context ("tool" role for tool results)
            for (let idx = 0; idx < currentResponse.toolCalls.length; idx++) {
              const toolCall = currentResponse.toolCalls[idx];
              if (toolCall.result !== undefined) {
                await contextManager.addMessage(conversationId, {
                  role: 'tool',
                  content: [
                    Prompt.makePart('tool-result', {
                      id: toolCallIds[idx],
                      name: toolCall.toolId,
                      result: toolCall.result,
                      isFailure: false,
                      providerExecuted: false,
                    }),
                  ],
                });
              }
            }
          }
        }

        // Add assistant response to context only if no tool calls were handled
        // (Tool calls already include the text content in the assistant message)
        const toolCallsHandled = currentResponse.toolCalls &&
          currentResponse.toolCalls.length > 0 &&
          currentResponse.toolCalls.some(tc => tc.result !== undefined);

        if (currentResponse.content && !toolCallsHandled) {
          const assistantMessage: Prompt.MessageEncoded = {
            role: 'assistant',
            content: currentResponse.content,
          };
          await contextManager.addMessage(conversationId, assistantMessage);
        }
      }

      return currentResponse;
    } catch (error) {
      if (rootSpan && error instanceof Error) {
        rootSpan.recordException(error);
        rootSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      if (rootSpan) {
        rootSpan.end();
        // Restore previous active span
        if (previousActiveSpan) {
          tracer?.setActiveSpan(previousActiveSpan);
        } else {
          tracer?.setActiveSpan(undefined);
        }
      }
    }
  }

  /**
   * Stream a user message through the intent system
   * Returns a StreamResult that provides multiple consumption patterns.
   * Supports agent handoffs - when an agent calls handoff_to_agent, streaming
   * continues from the target agent automatically.
   */
  streamMessage(
    message: string,
    options?: ProcessingOptions
  ): StreamResult {
    const {
      contextManager,
      agentManager,
      memoryDefaults,
    } = this.deps;

    const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
    const conversationId = options?.conversationId
      ? options.conversationId
      : requireConversationId
        ? undefined
        : contextManager.generateConversationId();
    const useSemantic = options?.useSemanticMatching ?? true;
    const threshold = options?.semanticThreshold ?? 0.6;
    const sequentialVisibility = options?.sequentialVisibility ?? memoryDefaults.sequentialVisibility ?? true;

    const self = this;
    const maxHandoffDepth = 10;

    // Helper to create a stream from an agent with handoff support
    const createAgentStreamWithHandoff = (
      agentId: string,
      currentMessage: string,
      previousMessages: AgentMessage[],
      handoffDepth: number,
      handoffContext?: Record<string, unknown>
    ): Stream.Stream<StreamEvent, Error> => {
      return Stream.unwrap(
        Effect.gen(function* () {
          const agent = agentManager.getAgent(agentId);
          if (!agent) {
            return yield* Effect.fail(new Error(`Agent "${agentId}" not found`));
          }

          const shouldPersistHistory = agent.config.persistHistory !== false;

          // If agent doesn't have streaming, fall back to processMessage with synthetic events
          if (!agent.streamMessage) {
            // Add user message if persistence is enabled
            if (shouldPersistHistory) {
              yield* Effect.promise(() =>
                contextManager.addMessage(conversationId!, {
                  role: 'user',
                  content: currentMessage,
                })
              );
            }

            const response = yield* Effect.promise(() =>
              agent.processMessage(currentMessage, sequentialVisibility ? previousMessages : [])
            );

            if (response.content && shouldPersistHistory) {
              yield* Effect.promise(() =>
                contextManager.addMessage(conversationId!, {
                  role: 'assistant',
                  content: response.content,
                })
              );
            }

            const idGen = createStreamIdGenerator();
            const events = generateSyntheticStreamEvents(
              {
                conversationId: conversationId!,
                message: currentMessage,
                previousMessages,
                response,
              },
              idGen
            );

            // Check for handoff in processMessage response
            if (response.handoff && handoffDepth < maxHandoffDepth) {
              const handoffEvent: HandoffStartEvent = makeHandoffStartEvent({
                runId: `run_${Date.now()}_handoff`,
                threadId: conversationId,
                fromAgentId: agentId,
                toAgentId: response.handoff.agentId,
                message: response.handoff.message || currentMessage,
                context: response.handoff.context,
                handoffDepth: handoffDepth + 1,
                sequence: events.length,
                emittedAt: Date.now(),
              });

              // Get updated history for target agent
              const updatedHistory = yield* Effect.promise(() =>
                contextManager.getHistory(conversationId!)
              );
              const updatedPreviousMessages: AgentMessage[] = updatedHistory.filter(
                msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
              ) as AgentMessage[];

              const targetMessage = response.handoff.message || currentMessage;
              const targetContext = response.handoff.context
                ? `\n\nContext: ${JSON.stringify(response.handoff.context)}`
                : '';

              return Stream.fromIterable(events).pipe(
                Stream.concat(Stream.make(handoffEvent)),
                Stream.concat(
                  createAgentStreamWithHandoff(
                    response.handoff.agentId,
                    targetMessage + targetContext,
                    updatedPreviousMessages,
                    handoffDepth + 1,
                    response.handoff.context
                  )
                )
              );
            }

            return Stream.fromIterable(events);
          }

          // Agent has streaming - use it with handoff detection
          // Add user message if persistence is enabled
          if (shouldPersistHistory) {
            yield* Effect.promise(() =>
              contextManager.addMessage(conversationId!, {
                role: 'user',
                content: currentMessage,
              })
            );
          }

          // Track per-step state for persistence
          type StepState = {
            stepIndex: number;
            text: string;
            toolCalls: Array<{
              id: string;
              toolName: string;
              args: Record<string, unknown>;
              result?: unknown;
              isFailure?: boolean;
            }>;
          };

          const stepStates = new Map<number, StepState>();

          const getOrCreateStepState = (stepIndex: number): StepState => {
            if (!stepStates.has(stepIndex)) {
              stepStates.set(stepIndex, {
                stepIndex,
                text: '',
                toolCalls: [],
              });
            }
            return stepStates.get(stepIndex)!;
          };

          // Track if we detect a handoff during streaming
          let detectedHandoff: RunEndEvent['result']['handoff'] | undefined;
          let lastRunEndEvent: RunEndEvent | undefined;

          const agentStream = agent.streamMessage(
            currentMessage,
            sequentialVisibility ? previousMessages : [],
            { threadId: conversationId }
          );

          // Process stream events, tracking state and detecting handoffs
          const processedStream = agentStream.pipe(
            Stream.tap((event) => {
              // Track per-step text and tool calls/results
              if (event.type === 'token' && 'step' in event) {
                const state = getOrCreateStepState(event.step);
                state.text = event.accumulated;
              }

              if (event.type === 'tool-call' && 'step' in event) {
                const state = getOrCreateStepState(event.step);
                state.toolCalls.push({
                  id: event.toolCallId,
                  toolName: event.toolName,
                  args: event.input,
                });
              }

              if (event.type === 'tool-result' && 'step' in event) {
                const state = getOrCreateStepState(event.step);
                const toolCall = state.toolCalls.find(tc => tc.id === event.toolCallId);
                if (toolCall) {
                  toolCall.result = event.output;
                  toolCall.isFailure = false;
                }
              }

              if (event.type === 'tool-error' && 'step' in event) {
                const state = getOrCreateStepState(event.step);
                const toolCall = state.toolCalls.find(tc => tc.id === event.toolCallId);
                if (toolCall) {
                  toolCall.result = event.error.message;
                  toolCall.isFailure = true;
                }
              }

              // On step-complete, persist history for that step (only if tool calls)
              if (event.type === 'step-complete' && shouldPersistHistory) {
                const state = stepStates.get(event.stepIndex);
                if (state && state.toolCalls.length > 0) {
                  return Effect.promise(async () => {
                    const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
                    if (state.text) {
                      assistantParts.push(Prompt.makePart('text', { text: state.text }));
                    }
                    state.toolCalls.forEach((tc) => {
                      assistantParts.push(
                        Prompt.makePart('tool-call', {
                          id: tc.id,
                          name: tc.toolName,
                          params: tc.args,
                          providerExecuted: false,
                        })
                      );
                    });
                    await contextManager.addMessage(conversationId!, {
                      role: 'assistant',
                      content: assistantParts,
                    });

                    for (const tc of state.toolCalls) {
                      if (tc.result !== undefined) {
                        await contextManager.addMessage(conversationId!, {
                          role: 'tool',
                          content: [
                            Prompt.makePart('tool-result', {
                              id: tc.id,
                              name: tc.toolName,
                              result: tc.result,
                              isFailure: tc.isFailure ?? false,
                              providerExecuted: false,
                            }),
                          ],
                        });
                      }
                    }

                    stepStates.delete(event.stepIndex);
                  });
                }
              }

              // On run-end, check for handoff and persist remaining text
              if (event.type === 'run-end') {
                lastRunEndEvent = event;
                if (event.result.handoff) {
                  detectedHandoff = event.result.handoff;
                }

                if (shouldPersistHistory) {
                  const remainingText = Array.from(stepStates.values())
                    .filter(state => state.text && state.toolCalls.length === 0)
                    .map(state => state.text)
                    .join('');

                  if (remainingText) {
                    return Effect.promise(async () => {
                      await contextManager.addMessage(conversationId!, {
                        role: 'assistant',
                        content: remainingText,
                      });
                      stepStates.clear();
                    });
                  }
                }
              }

              return Effect.void;
            })
          );

          // After the stream completes, check if we need to continue with a handoff
          const streamWithHandoffContinuation = Stream.unwrap(
            Effect.gen(function* () {
              // Collect all events first to detect handoff at the end
              const allEvents = yield* Stream.runCollect(processedStream);
              const eventsArray = Array.from(allEvents);

              // If no handoff or max depth reached, just return collected events
              if (!detectedHandoff || handoffDepth >= maxHandoffDepth) {
                if (handoffDepth >= maxHandoffDepth && detectedHandoff) {
                  console.warn('Maximum handoff depth reached. Stopping handoff chain.');
                }
                return Stream.fromIterable(eventsArray);
              }

              // Handoff detected - create handoff event and continue with target agent
              const handoffEvent: HandoffStartEvent = makeHandoffStartEvent({
                runId: lastRunEndEvent?.runId ?? `run_${Date.now()}_handoff`,
                threadId: conversationId,
                fromAgentId: agentId,
                toAgentId: detectedHandoff.agentId,
                message: detectedHandoff.message || currentMessage,
                context: detectedHandoff.context,
                handoffDepth: handoffDepth + 1,
                sequence: lastRunEndEvent ? lastRunEndEvent.sequence + 1 : eventsArray.length,
                emittedAt: Date.now(),
              });

              // Get updated history for target agent
              const updatedHistory = yield* Effect.promise(() =>
                contextManager.getHistory(conversationId!)
              );
              const updatedPreviousMessages: AgentMessage[] = updatedHistory.filter(
                msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
              ) as AgentMessage[];

              const targetMessage = detectedHandoff.message || currentMessage;
              const targetContext = detectedHandoff.context
                ? `\n\nContext: ${JSON.stringify(detectedHandoff.context)}`
                : '';

              return Stream.fromIterable(eventsArray).pipe(
                Stream.concat(Stream.make(handoffEvent)),
                Stream.concat(
                  createAgentStreamWithHandoff(
                    detectedHandoff.agentId,
                    targetMessage + targetContext,
                    updatedPreviousMessages,
                    handoffDepth + 1,
                    detectedHandoff.context
                  )
                )
              );
            })
          );

          return streamWithHandoffContinuation as Stream.Stream<StreamEvent, Error, never>;
        })
      ) as Stream.Stream<StreamEvent, Error>;
    };

    const initEffect = Effect.gen(function* () {
      validateMessageLength(message);
      if (!conversationId) {
        return yield* Effect.fail(new Error('Conversation ID is required for this request'));
      }

      const history = yield* Effect.promise(() => contextManager.getHistory(conversationId));

      const previousMessages: AgentMessage[] = history.filter(
        msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
      ) as AgentMessage[];

      const semanticMatcher = useSemantic
        ? async (msg: string, utterances: string[]) => {
            return semanticMatch(msg, utterances, threshold);
          }
        : undefined;

      const route = yield* Effect.promise(() =>
        self.routeMessage(
          message,
          semanticMatcher,
          sequentialVisibility ? previousMessages : [],
          { conversationId, sequentialVisibility }
        )
      );

      return { route, previousMessages };
    });

    const streamEffect = initEffect.pipe(
      Effect.flatMap(({ route, previousMessages }) =>
        Effect.gen(function* () {
          if (route.type === 'none') {
            return yield* Effect.fail(new Error('No agent found to handle message'));
          }

          if (route.type === 'pipeline' || route.type === 'intent') {
            if (!route.response) {
              return yield* Effect.fail(new Error(`Route type ${route.type} did not return a response`));
            }

            const userMessage: Prompt.MessageEncoded = {
              role: 'user',
              content: message,
            };
            yield* Effect.promise(() => contextManager.addMessage(conversationId!, userMessage));

            const assistantMessage: Prompt.MessageEncoded = {
              role: 'assistant',
              content: route.response.content,
            };
            yield* Effect.promise(() => contextManager.addMessage(conversationId!, assistantMessage));

            const idGen = createStreamIdGenerator();
            const events = generateSyntheticStreamEvents(
              {
                conversationId: conversationId!,
                message,
                previousMessages,
                response: route.response,
              },
              idGen
            );

            return Stream.fromIterable(events);
          }

          if (route.type === 'agent' || route.type === 'default') {
            if (!route.agent) {
              return yield* Effect.fail(new Error(`Route type ${route.type} did not return an agent`));
            }

            // Use the recursive handoff-aware streaming
            return createAgentStreamWithHandoff(
              route.agentId!,
              message,
              previousMessages,
              0 // Start at depth 0
            );
          }

          return yield* Effect.fail(new Error(`Unknown route type: ${route.type}`));
        })
      )
    );

    const asyncIterable = Stream.toAsyncIterable(Stream.unwrap(streamEffect));
    return createStreamResultFromIterable(asyncIterable);
  }

  /**
   * Process OpenAI-compatible chat messages
   */
  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    const { contextManager, memoryDefaults } = this.deps;

    const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
    const conversationId = options?.conversationId
      ? options.conversationId
      : requireConversationId
        ? undefined
        : contextManager.generateConversationId();

    if (!conversationId) {
      throw new Error('Conversation ID is required for this request');
    }

    const modelMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
    })) as Prompt.MessageEncoded[];

    // Extract the last user message
    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage.content);

    // Process through intent system
    const response = await this.processMessage(userMessageText, {
      conversationId,
      useSemanticMatching: options?.useSemanticMatching,
      semanticThreshold: options?.semanticThreshold,
      requireConversationId: options?.requireConversationId,
      sequentialVisibility: options?.sequentialVisibility,
    });

    return response;
  }
}

/**
 * Effect service tag for MessageProcessor
 */
export const MessageProcessorService = Context.GenericTag<MessageProcessor>('MessageProcessorService');
