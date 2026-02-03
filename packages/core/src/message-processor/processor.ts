import { Context, Effect, Stream } from 'effect';
import { Prompt } from '@effect/ai';
import type { AgentMessage, AgentResponse } from '../agent/agent';
import type { StreamEvent } from '../stream/events';
import { SpanKind } from '../tracing/types';
import { validateMessageLength } from '../utils/validation';
import { semanticMatch } from '../utils/semantic';
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
import {
  MessageValidationError,
  NoRouteFoundError,
  RouteExecutionError,
  HandoffError,
  ConversationIdRequiredError,
  AgentNotFoundError,
  MaxHandoffDepthError,
  type MessageProcessorError,
} from './errors';

/**
 * Maximum handoff depth to prevent infinite loops
 */
const MAX_HANDOFF_DEPTH = 10;

/**
 * MessageProcessor handles routing and processing of user messages.
 * Extracts the core message handling logic from Fred class.
 *
 * This class uses Effect internally for all operations and provides
 * both Effect-based and Promise-based APIs for flexibility.
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
   * Route a message to the appropriate handler (Effect-based)
   * Returns routing result with agent, pipeline, or intent information
   */
  routeMessageEffect(
    message: string,
    semanticMatcher?: SemanticMatcherFn,
    previousMessages: AgentMessage[] = [],
    options?: { conversationId?: string; sequentialVisibility?: boolean }
  ): Effect.Effect<RouteResult, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const {
        agentManager,
        pipelineManager,
        intentMatcher,
        intentRouter,
        tracer,
        messageRouter,
        defaultAgentId,
      } = self.deps;

      const conversationId = options?.conversationId;
      const sequentialVisibility = options?.sequentialVisibility ?? true;

      // Create span for routing
      const routingSpan = tracer?.startSpan('routing', {
        kind: SpanKind.INTERNAL,
      });

      if (routingSpan) {
        tracer?.setActiveSpan(routingSpan);
      }

      // Use Effect.acquireUseRelease pattern for span lifecycle management
      const executeRouting = Effect.gen(function* () {
        // If MessageRouter is configured, use rule-based routing
        if (messageRouter) {
          const decision = yield* messageRouter.route(message, {}).pipe(
            Effect.catchTag('NoAgentsAvailableError', (error) =>
              Effect.fail(new NoRouteFoundError({ message: `No agents available: ${error.message}` }))
            )
          );

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
            } as RouteResult;
          } else {
            if (routingSpan) {
              routingSpan.addEvent('agent.notFound', { 'agent.id': decision.agent });
              routingSpan.setStatus('error', `Agent ${decision.agent} not found`);
            }
            return { type: 'none' } as RouteResult;
          }
        }

        // Otherwise, use existing routing (agent utterances, pipelines, intents)
        // Check agent utterances first (direct routing)
        const agentMatch = yield* Effect.promise(() =>
          agentManager.matchAgentByUtterance(message, semanticMatcher)
        );

        if (agentMatch) {
          if (routingSpan) {
            routingSpan.setAttributes({
              'routing.method': 'agent.utterance',
              'routing.agentId': agentMatch.agentId,
              'routing.confidence': agentMatch.confidence,
              'routing.matchType': agentMatch.matchType,
            });
          }

          const agent = agentManager.getAgent(agentMatch.agentId);
          if (agent) {
            if (routingSpan) {
              routingSpan.setStatus('ok');
            }
            return {
              type: 'agent',
              agent,
              agentId: agentMatch.agentId,
            } as RouteResult;
          } else {
            if (routingSpan) {
              routingSpan.addEvent('agent.notFound', { 'agent.id': agentMatch.agentId });
            }
          }
        }

        // If no agent match, check pipeline utterances
        if (!agentMatch || (agentMatch && !agentManager.getAgent(agentMatch.agentId))) {
          const pipelineMatch = yield* Effect.promise(() =>
            pipelineManager.matchPipelineByUtterance(message, semanticMatcher)
          );

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

            const pipelineResult = yield* Effect.tryPromise({
              try: () => pipelineManager.executePipeline(
                pipelineMatch.pipelineId,
                message,
                previousMessages,
                {
                  conversationId,
                  sequentialVisibility,
                }
              ),
              catch: (error) => new RouteExecutionError({
                routeType: 'pipeline',
                cause: error,
              }),
            }).pipe(
              Effect.tap((response) => Effect.sync(() => {
                if (pipelineSpan) {
                  pipelineSpan.setAttribute('response.length', response.content.length);
                  pipelineSpan.setAttribute('response.hasToolCalls', (response.toolCalls?.length ?? 0) > 0);
                  pipelineSpan.setStatus('ok');
                }
                if (routingSpan) {
                  routingSpan.setStatus('ok');
                }
              })),
              Effect.ensuring(Effect.sync(() => {
                pipelineSpan?.end();
                if (previousPipelineSpan) {
                  tracer?.setActiveSpan(previousPipelineSpan);
                }
              }))
            );

            return {
              type: 'pipeline',
              pipelineId: pipelineMatch.pipelineId,
              response: pipelineResult,
            } as RouteResult;
          }

          // No pipeline match, try intent matching
          const match = yield* intentMatcher.matchIntent(message, semanticMatcher).pipe(
            Effect.catchTag('IntentMatchError', () => Effect.succeed(null))
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
                } as RouteResult;
              }
            } else {
              // Intent routes to pipeline - execute and return response
              const response = yield* intentRouter.routeIntent(match, message) as Effect.Effect<AgentResponse, never>;
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'intent',
                response,
              } as RouteResult;
            }
          }

          if (defaultAgentId) {
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
              } as RouteResult;
            }
          }
        }

        // No match and no default agent
        if (routingSpan) {
          routingSpan.setStatus('error', 'No routing target found');
        }
        return { type: 'none' } as RouteResult;
      });

      return yield* executeRouting.pipe(
        Effect.tapError((error) => Effect.sync(() => {
          if (routingSpan && error instanceof Error) {
            routingSpan.recordException(error);
            routingSpan.setStatus('error', error.message);
          }
        })),
        Effect.ensuring(Effect.sync(() => {
          routingSpan?.end();
        }))
      );
    });
  }

  /**
   * Route a message to the appropriate handler (Promise-based, for backward compatibility)
   */
  async routeMessage(
    message: string,
    semanticMatcher?: SemanticMatcherFn,
    previousMessages: AgentMessage[] = [],
    options?: { conversationId?: string; sequentialVisibility?: boolean }
  ): Promise<RouteResult> {
    return Effect.runPromise(
      this.routeMessageEffect(message, semanticMatcher, previousMessages, options).pipe(
        Effect.catchTag('RouteExecutionError', (error) =>
          Effect.die(error.cause instanceof Error ? error.cause : new Error(String(error.cause)))
        )
      )
    );
  }

  /**
   * Process a user message through the intent system (Effect-based)
   */
  processMessageEffect(
    message: string,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse | null, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const {
        contextManager,
        agentManager,
        tracer,
        memoryDefaults,
      } = self.deps;

      // Validate message input
      yield* Effect.try({
        try: () => validateMessageLength(message),
        catch: (error) => new MessageValidationError({
          message: 'Message validation failed',
          details: error instanceof Error ? error.message : String(error),
        }),
      });

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

      const executeProcessing = Effect.gen(function* () {
        const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
        const conversationId = options?.conversationId
          ? options.conversationId
          : requireConversationId
            ? undefined
            : contextManager.generateConversationId();
        const useSemantic = options?.useSemanticMatching ?? true;
        const threshold = options?.semanticThreshold ?? 0.6;

        if (!conversationId) {
          return yield* Effect.fail(new ConversationIdRequiredError({}));
        }

        if (rootSpan) {
          rootSpan.setAttribute('conversation.id', conversationId);
        }

        // Get conversation history
        const history = yield* Effect.promise(() => contextManager.getHistory(conversationId));

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
        const route = yield* self.routeMessageEffect(
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
          if (!route.response) {
            return yield* Effect.fail(new RouteExecutionError({
              routeType: route.type,
              cause: new Error(`Route type ${route.type} did not return a response`),
            }));
          }
          response = route.response;
        } else if (route.type === 'agent' || route.type === 'default') {
          if (!route.agent) {
            return yield* Effect.fail(new RouteExecutionError({
              routeType: route.type,
              cause: new Error(`Route type ${route.type} did not return an agent`),
            }));
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

          response = yield* Effect.tryPromise({
            try: () => route.agent!.processMessage(
              message,
              sequentialVisibility ? previousMessages : []
            ),
            catch: (error) => new RouteExecutionError({
              routeType: 'agent',
              cause: error,
            }),
          }).pipe(
            Effect.tap((resp) => Effect.sync(() => {
              if (agentSpan) {
                agentSpan.setAttribute('response.length', resp.content.length);
                agentSpan.setAttribute('response.hasToolCalls', (resp.toolCalls?.length ?? 0) > 0);
                agentSpan.setAttribute('response.hasHandoff', resp.handoff !== undefined);
                agentSpan.setStatus('ok');
              }
            })),
            Effect.tapError((error) => Effect.sync(() => {
              if (agentSpan) {
                agentSpan.recordException(error instanceof Error ? error : new Error(String(error)));
                agentSpan.setStatus('error', error instanceof Error ? error.message : String(error));
              }
            })),
            Effect.ensuring(Effect.sync(() => {
              agentSpan?.end();
              if (previousAgentSpan) {
                tracer?.setActiveSpan(previousAgentSpan);
              }
            }))
          );
        } else {
          return yield* Effect.fail(new RouteExecutionError({
            routeType: 'unknown',
            cause: new Error(`Unknown route type: ${route.type}`),
          }));
        }

        // Process handoffs recursively using Effect
        const processHandoffs = (
          currentResponse: AgentResponse,
          handoffDepth: number,
          currentAgentId: string | null
        ): Effect.Effect<{ response: AgentResponse; agentId: string | null }, MessageProcessorError> =>
          Effect.gen(function* () {
            if (!currentResponse.handoff || handoffDepth >= MAX_HANDOFF_DEPTH) {
              if (handoffDepth >= MAX_HANDOFF_DEPTH && currentResponse.handoff) {
                yield* Effect.logWarning('Maximum handoff depth reached. Stopping handoff chain.');
                if (rootSpan) {
                  rootSpan.addEvent('handoff.maxDepthReached', { 'maxDepth': MAX_HANDOFF_DEPTH });
                }
              }
              return { response: currentResponse, agentId: currentAgentId };
            }

            const handoff = currentResponse.handoff;

            // Create span for handoff
            const handoffSpan = tracer?.startSpan('agent.handoff', {
              kind: SpanKind.INTERNAL,
              attributes: {
                'handoff.depth': handoffDepth + 1,
                'handoff.fromAgent': currentAgentId || 'unknown',
                'handoff.toAgent': handoff.agentId,
                'handoff.hasContext': handoff.context !== undefined,
              },
            });

            const previousHandoffSpan = tracer?.getActiveSpan();
            if (handoffSpan) {
              tracer?.setActiveSpan(handoffSpan);
            }

            // Get target agent
            const targetAgent = agentManager.getAgent(handoff.agentId);
            if (!targetAgent) {
              if (handoffSpan) {
                handoffSpan.addEvent('agent.notFound', { 'agent.id': handoff.agentId });
                handoffSpan.setStatus('error', 'Target agent not found');
                handoffSpan.end();
              }
              if (previousHandoffSpan) {
                tracer?.setActiveSpan(previousHandoffSpan);
              }
              return { response: currentResponse, agentId: currentAgentId };
            }

            // Prepare handoff message
            const handoffMessage = handoff.message || message;
            const handoffContext = handoff.context ? `\n\nContext: ${JSON.stringify(handoff.context)}` : '';
            const messageWithContext = handoffMessage + handoffContext;

            // Process message with target agent
            const nextResponse = yield* Effect.tryPromise({
              try: () => targetAgent.processMessage(messageWithContext, previousMessages),
              catch: (error) => new HandoffError({
                fromAgentId: currentAgentId || 'unknown',
                toAgentId: handoff.agentId,
                cause: error,
              }),
            }).pipe(
              Effect.tap((resp) => Effect.sync(() => {
                if (handoffSpan) {
                  handoffSpan.setAttribute('handoff.response.length', resp.content.length);
                  handoffSpan.setStatus('ok');
                }
              })),
              Effect.tapError((error) => Effect.sync(() => {
                if (handoffSpan) {
                  handoffSpan.recordException(error instanceof Error ? error : new Error(String(error)));
                  handoffSpan.setStatus('error', error instanceof Error ? error.message : String(error));
                }
              })),
              Effect.ensuring(Effect.sync(() => {
                handoffSpan?.end();
                if (previousHandoffSpan) {
                  tracer?.setActiveSpan(previousHandoffSpan);
                }
              }))
            );

            // Recursively process any further handoffs
            return yield* processHandoffs(nextResponse, handoffDepth + 1, handoff.agentId);
          });

        const { response: finalResponse, agentId: finalAgentId } = yield* processHandoffs(response, 0, usedAgentId);

        if (rootSpan) {
          rootSpan.setAttributes({
            'response.length': finalResponse.content.length,
            'response.hasToolCalls': (finalResponse.toolCalls?.length ?? 0) > 0,
          });
          rootSpan.setStatus('ok');
        }

        // Check if the routed agent allows history persistence
        const routedAgent = finalAgentId ? agentManager.getAgent(finalAgentId) : route.agent;
        const shouldPersistHistory = routedAgent?.config.persistHistory !== false;

        if (shouldPersistHistory) {
          // Add user message to context
          const userMessage: Prompt.MessageEncoded = {
            role: 'user',
            content: message,
          };
          yield* Effect.promise(() => contextManager.addMessage(conversationId, userMessage));

          // Handle tool calls: add them to context for persistence
          if (finalResponse.toolCalls && finalResponse.toolCalls.length > 0) {
            const hasToolResults = finalResponse.toolCalls.some(tc => tc.result !== undefined);

            if (hasToolResults) {
              const baseTimestamp = Date.now();
              const toolCallIds = finalResponse.toolCalls.map(
                (toolCall, idx) => `call_${toolCall.toolId}_${baseTimestamp}_${idx}`
              );
              const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
              if (finalResponse.content) {
                assistantParts.push(Prompt.makePart('text', { text: finalResponse.content }));
              }
              finalResponse.toolCalls.forEach((toolCall, idx) => {
                assistantParts.push(
                  Prompt.makePart('tool-call', {
                    id: toolCallIds[idx],
                    name: toolCall.toolId,
                    params: toolCall.args,
                    providerExecuted: false,
                  })
                );
              });
              yield* Effect.promise(() =>
                contextManager.addMessage(conversationId, {
                  role: 'assistant',
                  content: assistantParts,
                })
              );

              // Add tool results to context
              for (let idx = 0; idx < finalResponse.toolCalls.length; idx++) {
                const toolCall = finalResponse.toolCalls[idx];
                if (toolCall.result !== undefined) {
                  yield* Effect.promise(() =>
                    contextManager.addMessage(conversationId, {
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
                    })
                  );
                }
              }
            }
          }

          // Add assistant response to context only if no tool calls were handled
          const toolCallsHandled = finalResponse.toolCalls &&
            finalResponse.toolCalls.length > 0 &&
            finalResponse.toolCalls.some(tc => tc.result !== undefined);

          if (finalResponse.content && !toolCallsHandled) {
            const assistantMessage: Prompt.MessageEncoded = {
              role: 'assistant',
              content: finalResponse.content,
            };
            yield* Effect.promise(() => contextManager.addMessage(conversationId, assistantMessage));
          }
        }

        return finalResponse;
      });

      return yield* executeProcessing.pipe(
        Effect.tapError((error) => Effect.sync(() => {
          if (rootSpan && error instanceof Error) {
            rootSpan.recordException(error);
            rootSpan.setStatus('error', error.message);
          }
        })),
        Effect.ensuring(Effect.sync(() => {
          if (rootSpan) {
            rootSpan.end();
            if (previousActiveSpan) {
              tracer?.setActiveSpan(previousActiveSpan);
            } else {
              tracer?.setActiveSpan(undefined);
            }
          }
        }))
      );
    });
  }

  /**
   * Process a user message through the intent system (Promise-based, for backward compatibility)
   */
  async processMessage(
    message: string,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    return Effect.runPromise(
      this.processMessageEffect(message, options).pipe(
        Effect.catchTag('MessageValidationError', (error) =>
          Effect.die(new Error(error.details || error.message))
        ),
        Effect.catchTag('ConversationIdRequiredError', () =>
          Effect.die(new Error('Conversation ID is required for this request'))
        ),
        Effect.catchTag('RouteExecutionError', (error) =>
          Effect.die(error.cause instanceof Error ? error.cause : new Error(String(error.cause)))
        ),
        Effect.catchTag('HandoffError', (error) =>
          Effect.die(error.cause instanceof Error ? error.cause : new Error(String(error.cause)))
        ),
        Effect.catchTag('NoRouteFoundError', () =>
          Effect.succeed(null)
        ),
        Effect.catchTag('AgentNotFoundError', (error) =>
          Effect.die(new Error(`Agent not found: ${error.agentId}`))
        ),
        Effect.catchTag('MaxHandoffDepthError', (error) =>
          Effect.die(new Error(`Maximum handoff depth ${error.maxDepth} exceeded at depth ${error.depth}`))
        )
      )
    );
  }

  /**
   * Stream a user message through the intent system (Effect-based)
   * Returns an Effect that produces a Stream of StreamEvents.
   */
  streamMessageEffect(
    message: string,
    options?: ProcessingOptions
  ): Effect.Effect<Stream.Stream<StreamEvent, MessageProcessorError>, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const {
        contextManager,
        memoryDefaults,
      } = self.deps;

      // Validate message input
      yield* Effect.try({
        try: () => validateMessageLength(message),
        catch: (error) => new MessageValidationError({
          message: 'Message validation failed',
          details: error instanceof Error ? error.message : String(error),
        }),
      });

      const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
      const conversationId = options?.conversationId
        ? options.conversationId
        : requireConversationId
          ? undefined
          : contextManager.generateConversationId();
      const useSemantic = options?.useSemanticMatching ?? true;
      const threshold = options?.semanticThreshold ?? 0.6;
      const sequentialVisibility = options?.sequentialVisibility ?? memoryDefaults.sequentialVisibility ?? true;

      if (!conversationId) {
        return yield* Effect.fail(new ConversationIdRequiredError({}));
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

      const route = yield* self.routeMessageEffect(
        message,
        semanticMatcher,
        sequentialVisibility ? previousMessages : [],
        { conversationId, sequentialVisibility }
      );

      if (route.type === 'none') {
        return yield* Effect.fail(new NoRouteFoundError({ message }));
      }

      if (route.type === 'pipeline' || route.type === 'intent') {
        if (!route.response) {
          return yield* Effect.fail(new RouteExecutionError({
            routeType: route.type,
            cause: new Error(`Route type ${route.type} did not return a response`),
          }));
        }

        const userMessage: Prompt.MessageEncoded = {
          role: 'user',
          content: message,
        };
        yield* Effect.promise(() => contextManager.addMessage(conversationId, userMessage));

        const assistantMessage: Prompt.MessageEncoded = {
          role: 'assistant',
          content: route.response.content,
        };
        yield* Effect.promise(() => contextManager.addMessage(conversationId, assistantMessage));

        const idGen = createStreamIdGenerator();
        const events = generateSyntheticStreamEvents(
          {
            conversationId,
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
          return yield* Effect.fail(new RouteExecutionError({
            routeType: route.type,
            cause: new Error(`Route type ${route.type} did not return an agent`),
          }));
        }

        return self.createAgentStreamWithHandoff(
          route.agentId!,
          message,
          previousMessages,
          0,
          conversationId,
          sequentialVisibility
        );
      }

      return yield* Effect.fail(new RouteExecutionError({
        routeType: 'unknown',
        cause: new Error(`Unknown route type: ${route.type}`),
      }));
    });
  }

  /**
   * Create an agent stream with handoff support (Effect-based helper)
   */
  private createAgentStreamWithHandoff(
    agentId: string,
    currentMessage: string,
    previousMessages: AgentMessage[],
    handoffDepth: number,
    conversationId: string,
    sequentialVisibility: boolean,
    handoffContext?: Record<string, unknown>
  ): Stream.Stream<StreamEvent, MessageProcessorError> {
    const self = this;
    const { contextManager, agentManager } = this.deps;

    return Stream.unwrap(
      Effect.gen(function* () {
        const agent = agentManager.getAgent(agentId);
        if (!agent) {
          return yield* Effect.fail(new AgentNotFoundError({ agentId }));
        }

        const shouldPersistHistory = agent.config.persistHistory !== false;

        // If agent doesn't have streaming, fall back to processMessage with synthetic events
        if (!agent.streamMessage) {
          if (shouldPersistHistory) {
            yield* Effect.promise(() =>
              contextManager.addMessage(conversationId, {
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
              contextManager.addMessage(conversationId, {
                role: 'assistant',
                content: response.content,
              })
            );
          }

          const idGen = createStreamIdGenerator();
          const events = generateSyntheticStreamEvents(
            {
              conversationId,
              message: currentMessage,
              previousMessages,
              response,
            },
            idGen
          );

          // Check for handoff in processMessage response
          if (response.handoff && handoffDepth < MAX_HANDOFF_DEPTH) {
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
              contextManager.getHistory(conversationId)
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
                self.createAgentStreamWithHandoff(
                  response.handoff.agentId,
                  targetMessage + targetContext,
                  updatedPreviousMessages,
                  handoffDepth + 1,
                  conversationId,
                  sequentialVisibility,
                  response.handoff.context
                )
              )
            );
          }

          return Stream.fromIterable(events);
        }

        // Agent has streaming - use it with handoff detection
        if (shouldPersistHistory) {
          yield* Effect.promise(() =>
            contextManager.addMessage(conversationId, {
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

        let detectedHandoff: RunEndEvent['result']['handoff'] | undefined;
        let lastRunEndEvent: RunEndEvent | undefined;

        const agentStream = agent.streamMessage(
          currentMessage,
          sequentialVisibility ? previousMessages : [],
          { threadId: conversationId }
        );

        // Process stream events, tracking state and detecting handoffs
        const processedStream = agentStream.pipe(
          Stream.tap((event) =>
            Effect.gen(function* () {
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
                  yield* Effect.promise(async () => {
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
                    await contextManager.addMessage(conversationId, {
                      role: 'assistant',
                      content: assistantParts,
                    });

                    for (const tc of state.toolCalls) {
                      if (tc.result !== undefined) {
                        await contextManager.addMessage(conversationId, {
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
                    yield* Effect.promise(async () => {
                      await contextManager.addMessage(conversationId, {
                        role: 'assistant',
                        content: remainingText,
                      });
                      stepStates.clear();
                    });
                  }
                }
              }
            })
          )
        );

        // Stream events incrementally, then check for handoff continuation after completion
        // Using Stream.concat with Stream.suspend for lazy evaluation - handoff state is
        // populated by Stream.tap as events flow through, then checked after stream completes
        const streamWithHandoffContinuation = processedStream.pipe(
          Stream.concat(
            Stream.suspend(() => {
              // This runs after processedStream completes - detectedHandoff is now set if present
              if (!detectedHandoff || handoffDepth >= MAX_HANDOFF_DEPTH) {
                if (handoffDepth >= MAX_HANDOFF_DEPTH && detectedHandoff) {
                  console.warn('[Fred] Maximum handoff depth reached. Stopping handoff chain.');
                }
                return Stream.empty;
              }

              // Handoff detected - create handoff event and continue with target agent
              return Stream.unwrap(
                Effect.gen(function* () {
                  const handoffEvent: HandoffStartEvent = makeHandoffStartEvent({
                    runId: lastRunEndEvent?.runId ?? `run_${Date.now()}_handoff`,
                    threadId: conversationId,
                    fromAgentId: agentId,
                    toAgentId: detectedHandoff!.agentId,
                    message: detectedHandoff!.message || currentMessage,
                    context: detectedHandoff!.context,
                    handoffDepth: handoffDepth + 1,
                    sequence: lastRunEndEvent ? lastRunEndEvent.sequence + 1 : 0,
                    emittedAt: Date.now(),
                  });

                  // Get updated history for target agent
                  const updatedHistory = yield* Effect.promise(() =>
                    contextManager.getHistory(conversationId)
                  );
                  const updatedPreviousMessages: AgentMessage[] = updatedHistory.filter(
                    msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
                  ) as AgentMessage[];

                  const targetMessage = detectedHandoff!.message || currentMessage;
                  const targetContext = detectedHandoff!.context
                    ? `\n\nContext: ${JSON.stringify(detectedHandoff!.context)}`
                    : '';

                  return Stream.make(handoffEvent).pipe(
                    Stream.concat(
                      self.createAgentStreamWithHandoff(
                        detectedHandoff!.agentId,
                        targetMessage + targetContext,
                        updatedPreviousMessages,
                        handoffDepth + 1,
                        conversationId,
                        sequentialVisibility,
                        detectedHandoff!.context
                      )
                    )
                  );
                })
              );
            })
          )
        );

        return streamWithHandoffContinuation as Stream.Stream<StreamEvent, MessageProcessorError, never>;
      })
    ) as Stream.Stream<StreamEvent, MessageProcessorError>;
  }

  /**
   * Stream a user message through the intent system (original API, for backward compatibility)
   * Returns a StreamResult that provides multiple consumption patterns.
   */
  streamMessage(
    message: string,
    options?: ProcessingOptions
  ): StreamResult {
    const streamEffect = this.streamMessageEffect(message, options).pipe(
      Effect.catchAll((error) => {
        // Convert tagged errors to stream errors
        const errorMessage = '_tag' in error ? error._tag : String(error);
        return Effect.succeed(Stream.fail(new Error(errorMessage)));
      })
    );

    const asyncIterable = Stream.toAsyncIterable(
      Stream.unwrap(streamEffect as Effect.Effect<Stream.Stream<StreamEvent, Error>, never>)
    );
    return createStreamResultFromIterable(asyncIterable);
  }

  /**
   * Process OpenAI-compatible chat messages (Effect-based)
   */
  processChatMessageEffect(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse | null, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const { contextManager, memoryDefaults } = self.deps;

      const requireConversationId = options?.requireConversationId ?? memoryDefaults.requireConversationId;
      const conversationId = options?.conversationId
        ? options.conversationId
        : requireConversationId
          ? undefined
          : contextManager.generateConversationId();

      if (!conversationId) {
        return yield* Effect.fail(new ConversationIdRequiredError({}));
      }

      const modelMessages = messages.map((message) => ({
        role: message.role,
        content: message.content,
      })) as Prompt.MessageEncoded[];

      // Extract the last user message
      const lastUserMessage = modelMessages[modelMessages.length - 1];
      if (!lastUserMessage || lastUserMessage.role !== 'user') {
        return yield* Effect.fail(new MessageValidationError({
          message: 'Last message must be from user',
        }));
      }

      const userMessageText = typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage.content);

      // Process through intent system
      return yield* self.processMessageEffect(userMessageText, {
        conversationId,
        useSemanticMatching: options?.useSemanticMatching,
        semanticThreshold: options?.semanticThreshold,
        requireConversationId: options?.requireConversationId,
        sequentialVisibility: options?.sequentialVisibility,
      });
    });
  }

  /**
   * Process OpenAI-compatible chat messages (Promise-based, for backward compatibility)
   */
  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    return Effect.runPromise(
      this.processChatMessageEffect(messages, options).pipe(
        Effect.catchTag('ConversationIdRequiredError', () =>
          Effect.die(new Error('Conversation ID is required for this request'))
        ),
        Effect.catchTag('MessageValidationError', (error) =>
          Effect.die(new Error(error.message))
        )
      )
    );
  }
}

/**
 * Effect service tag for MessageProcessor
 */
export const MessageProcessorTag = Context.GenericTag<MessageProcessor>('MessageProcessorService');
