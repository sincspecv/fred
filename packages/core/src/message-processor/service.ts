/**
 * MessageProcessorService - Effect-based message processing
 *
 * This service handles routing and processing of user messages using Effect patterns.
 * It replaces the class-based MessageProcessor with proper Effect service composition.
 */

import { Context, Effect, Layer, Ref, Stream, Chunk } from 'effect';
import { Prompt } from '@effect/ai';
import type { AgentMessage, AgentResponse, AgentInstance } from '../agent/agent';
import type { StreamEvent, RunEndEvent, HandoffStartEvent } from '../stream/events';
import { makeHandoffStartEvent } from '../stream/events';
import { SpanKind } from '../tracing/types';
import type { Tracer } from '../tracing';
import { validateMessageLength } from '../utils/validation';
import { semanticMatch } from '../utils/semantic';
import {
  createStreamIdGenerator,
  generateSyntheticStreamEvents,
} from './stream-events';
import {
  MessageValidationError,
  NoRouteFoundError,
  RouteExecutionError,
  HandoffError,
  ConversationIdRequiredError,
  AgentNotFoundError,
  MaxHandoffDepthError,
} from './errors';
import type { ContextStorageError } from '../context/errors';
import type { PipelineExecutionError } from '../pipeline/errors';
import type {
  IntentMatchError,
  ActionHandlerNotFoundError,
  IntentRouteError,
} from '../intent/errors';
import type { NoAgentsAvailableError } from '../routing/errors';

/**
 * Extended error type that includes all possible errors from message processing
 */
export type MessageProcessorError =
  | import('./errors').MessageProcessorError
  | ContextStorageError
  | PipelineExecutionError
  | RouteError;
import type {
  RouteResult,
  ProcessingOptions,
  MemoryDefaults,
  SemanticMatcherFn,
} from './types';
import { AgentService } from '../agent/service';
import { PipelineService } from '../pipeline/service';
import { ContextStorageService } from '../context/service';
import {
  IntentMatcherService,
  IntentRouterService,
} from '../intent/service';
import { MessageRouterService } from '../routing/service';

/**
 * Configuration for MessageProcessorService
 */
export interface MessageProcessorConfig {
  defaultAgentId?: string;
  memoryDefaults: MemoryDefaults;
  tracer?: Tracer;
}

/**
 * Route options for routing a message
 */
export interface RouteOptions {
  conversationId?: string;
  sequentialVisibility?: boolean;
}

/**
 * Route error type - all errors that can occur during message routing
 */
export type RouteError =
  | RouteExecutionError
  | PipelineExecutionError
  | IntentMatchError
  | ActionHandlerNotFoundError
  | IntentRouteError
  | NoAgentsAvailableError;

/**
 * MessageProcessorService interface
 */
export interface MessageProcessorService {
  /**
   * Route a message to the appropriate handler
   */
  routeMessage(
    message: string,
    semanticMatcher?: SemanticMatcherFn,
    previousMessages?: AgentMessage[],
    options?: RouteOptions
  ): Effect.Effect<RouteResult, RouteError>;

  /**
   * Process a user message through the intent system
   */
  processMessage(
    message: string,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse, MessageProcessorError>;

  /**
   * Stream a user message through the intent system
   */
  streamMessage(
    message: string,
    options?: ProcessingOptions
  ): Stream.Stream<StreamEvent, MessageProcessorError>;

  /**
   * Process OpenAI-compatible chat messages
   */
  processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse, MessageProcessorError>;

  /**
   * Update service configuration
   */
  updateConfig(
    config: Partial<MessageProcessorConfig>
  ): Effect.Effect<void>;

  /**
   * Get current configuration
   */
  getConfig(): Effect.Effect<MessageProcessorConfig>;
}

export const MessageProcessorService = Context.GenericTag<MessageProcessorService>(
  'MessageProcessorService'
);

/**
 * Maximum handoff depth to prevent infinite loops
 */
const MAX_HANDOFF_DEPTH = 10;

/**
 * Implementation of MessageProcessorService
 */
class MessageProcessorServiceImpl implements MessageProcessorService {
  constructor(
    private readonly agentService: typeof AgentService.Service,
    private readonly pipelineService: typeof PipelineService.Service,
    private readonly contextStorage: typeof ContextStorageService.Service,
    private readonly intentMatcherService: typeof IntentMatcherService.Service | undefined,
    private readonly intentRouterService: typeof IntentRouterService.Service | undefined,
    private readonly messageRouterService: typeof MessageRouterService.Service | undefined,
    private readonly config: Ref.Ref<MessageProcessorConfig>
  ) {}

  routeMessage(
    message: string,
    semanticMatcher?: SemanticMatcherFn,
    previousMessages: AgentMessage[] = [],
    options?: RouteOptions
  ): Effect.Effect<RouteResult, RouteError> {
    const self = this;

    return Effect.gen(function* () {
      const config = yield* Ref.get(self.config);
      const conversationId = options?.conversationId;
      const sequentialVisibility = options?.sequentialVisibility ?? true;

      // Create span for routing
      const tracer = config.tracer;
      const routingSpan = tracer?.startSpan('routing', {
        kind: SpanKind.INTERNAL,
      });

      if (routingSpan) {
        tracer?.setActiveSpan(routingSpan);
      }

      try {
        // If MessageRouter is configured, use rule-based routing
        if (self.messageRouterService) {
          const decision = yield* self.messageRouterService.route(message, {});

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

          const agent = yield* self.agentService.getAgentOptional(decision.agent);
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

        // Check agent utterances first (direct routing)
        const agentMatch = yield* self.agentService.matchAgentByUtterance(message, semanticMatcher);

        if (agentMatch) {
          if (routingSpan) {
            routingSpan.setAttributes({
              'routing.method': 'agent.utterance',
              'routing.agentId': agentMatch.agentId,
              'routing.confidence': agentMatch.confidence,
              'routing.matchType': agentMatch.matchType,
            });
          }

          const agent = yield* self.agentService.getAgentOptional(agentMatch.agentId);
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

        // Check pipeline utterances
        const pipelineMatch = yield* self.pipelineService.matchPipelineByUtterance(message, semanticMatcher);

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
            const response = yield* self.pipelineService.executePipeline(
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
            } as RouteResult;
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
        }

        // Try intent matching if service is configured
        if (self.intentMatcherService && self.intentRouterService) {
          const match = yield* self.intentMatcherService.matchIntent(message, semanticMatcher);

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
              const agent = yield* self.agentService.getAgentOptional(match.intent.action.target);
              if (agent) {
                if (routingSpan) {
                  routingSpan.setStatus('ok');
                }
                return {
                  type: 'agent',
                  agent,
                  agentId: match.intent.action.target,
                  intentId: match.intent.id,
                } as RouteResult;
              }
            } else {
              // Intent routes to pipeline - execute and return response
              const response = yield* self.intentRouterService.routeIntent(match, message);
              if (routingSpan) {
                routingSpan.setStatus('ok');
              }
              return {
                type: 'intent',
                response,
              } as RouteResult;
            }
          }
        }

        // Fall back to default agent
        if (config.defaultAgentId) {
          if (routingSpan) {
            routingSpan.setAttributes({
              'routing.method': 'default.agent',
              'routing.defaultAgentId': config.defaultAgentId,
            });
          }

          const agent = yield* self.agentService.getAgentOptional(config.defaultAgentId);
          if (agent) {
            if (routingSpan) {
              routingSpan.setStatus('ok');
            }
            return {
              type: 'default',
              agent,
              agentId: config.defaultAgentId,
            } as RouteResult;
          }
        }

        // No match and no default agent
        if (routingSpan) {
          routingSpan.setStatus('error', 'No routing target found');
        }
        return { type: 'none' } as RouteResult;
      } catch (error) {
        if (routingSpan && error instanceof Error) {
          routingSpan.recordException(error);
          routingSpan.setStatus('error', error.message);
        }
        return yield* Effect.fail(
          new RouteExecutionError({ routeType: 'routing', cause: error instanceof Error ? error : new Error(String(error)) })
        );
      } finally {
        routingSpan?.end();
      }
    });
  }

  processMessage(
    message: string,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const config = yield* Ref.get(self.config);

      // Validate message input
      try {
        validateMessageLength(message);
      } catch (error) {
        return yield* Effect.fail(
          new MessageValidationError({
            message: 'Message validation failed',
            details: error instanceof Error ? error.message : String(error),
          })
        );
      }

      // Create root span for message processing
      const tracer = config.tracer;
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
        const requireConversationId = options?.requireConversationId ?? config.memoryDefaults.requireConversationId;
        let conversationId = options?.conversationId;

        if (!conversationId && !requireConversationId) {
          conversationId = yield* self.contextStorage.generateConversationId();
        }

        if (!conversationId) {
          return yield* Effect.fail(new ConversationIdRequiredError({}));
        }

        const useSemantic = options?.useSemanticMatching ?? true;
        const threshold = options?.semanticThreshold ?? 0.6;

        if (rootSpan) {
          rootSpan.setAttribute('conversation.id', conversationId);
        }

        // Get conversation history
        const history = yield* self.contextStorage.getHistory(conversationId);

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
        const sequentialVisibility = options?.sequentialVisibility ?? config.memoryDefaults.sequentialVisibility ?? true;
        const route = yield* self.routeMessage(
          message,
          semanticMatcher,
          sequentialVisibility ? previousMessages : [],
          { conversationId, sequentialVisibility }
        );

        let response: AgentResponse;
        let usedAgentId: string | null = null;

        // Handle routing result
        if (route.type === 'none') {
          return yield* Effect.fail(new NoRouteFoundError({ message }));
        }

        if (route.type === 'pipeline' || route.type === 'intent') {
          if (!route.response) {
            return yield* Effect.fail(
              new RouteExecutionError({ routeType: route.type, cause: new Error(`Route type ${route.type} did not return a response`) })
            );
          }
          response = route.response;
        } else if (route.type === 'agent' || route.type === 'default') {
          if (!route.agent) {
            return yield* Effect.fail(
              new RouteExecutionError({ routeType: route.type, cause: new Error(`Route type ${route.type} did not return an agent`) })
            );
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
            response = yield* Effect.tryPromise({
              try: () =>
                (route.agent!.processMessage as any)(
                  message,
                  sequentialVisibility ? previousMessages : [],
                  {
                    policyContext: {
                      intentId: route.intentId,
                      agentId: route.agentId,
                      conversationId,
                      userId: options?.userId,
                      role: options?.role,
                      metadata: options?.policyMetadata,
                    },
                  }
                ) as Promise<AgentResponse>,
              catch: (error) =>
                new RouteExecutionError({ routeType: 'agent', cause: error instanceof Error ? error : new Error(String(error)) }),
            });
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
          return yield* Effect.fail(
            new RouteExecutionError({ routeType: 'unknown', cause: new Error(`Unknown route type: ${route.type}`) })
          );
        }

        // Process handoffs recursively
        let handoffDepth = 0;
        let currentResponse = response;

        while (currentResponse.handoff && handoffDepth < MAX_HANDOFF_DEPTH) {
          handoffDepth++;
          const handoff = currentResponse.handoff;

          // Create span for handoff
          const handoffSpan = tracer?.startSpan('agent.handoff', {
            kind: SpanKind.INTERNAL,
            attributes: {
              'handoff.depth': handoffDepth,
              'handoff.fromAgent': usedAgentId || 'unknown',
              'handoff.toAgent': handoff.agentId,
              'handoff.hasContext': handoff.context !== undefined,
            },
          });

          const previousHandoffSpan = tracer?.getActiveSpan();
          if (handoffSpan) {
            tracer?.setActiveSpan(handoffSpan);
          }

          // Get target agent
          const targetAgent = yield* self.agentService.getAgentOptional(handoff.agentId);
          if (!targetAgent) {
            if (handoffSpan) {
              handoffSpan.addEvent('agent.notFound', { 'agent.id': handoff.agentId });
              handoffSpan.setStatus('error', 'Target agent not found');
              handoffSpan.end();
            }
            if (previousHandoffSpan) {
              tracer?.setActiveSpan(previousHandoffSpan);
            }
            break;
          }

          // Prepare handoff message
          const handoffMessage = handoff.message || message;
          const handoffContext = handoff.context ? `\n\nContext: ${JSON.stringify(handoff.context)}` : '';
          const messageWithContext = handoffMessage + handoffContext;

          // Process message with target agent
          const handoffResult = yield* Effect.tryPromise({
            try: () => targetAgent.processMessage(messageWithContext, previousMessages),
            catch: (error) =>
              new HandoffError({ fromAgentId: usedAgentId || 'unknown', toAgentId: handoff.agentId, cause: error instanceof Error ? error : new Error(String(error)) }),
          });
          currentResponse = handoffResult;
          usedAgentId = handoff.agentId;

          if (handoffSpan) {
            handoffSpan.setAttribute('handoff.response.length', currentResponse.content.length);
            handoffSpan.setStatus('ok');
            handoffSpan.end();
          }
          if (previousHandoffSpan) {
            tracer?.setActiveSpan(previousHandoffSpan);
          }
        }

        if (handoffDepth >= MAX_HANDOFF_DEPTH) {
          console.warn('Maximum handoff depth reached. Stopping handoff chain.');
          if (rootSpan) {
            rootSpan.addEvent('handoff.maxDepthReached', { 'maxDepth': MAX_HANDOFF_DEPTH });
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

        // Check if the routed agent allows history persistence
        const routedAgent = usedAgentId
          ? yield* self.agentService.getAgentOptional(usedAgentId)
          : route.agent;
        const shouldPersistHistory = routedAgent?.config.persistHistory !== false;

        if (shouldPersistHistory) {
          // Add user message to context
          const userMessage: Prompt.MessageEncoded = {
            role: 'user',
            content: message,
          };
          yield* self.contextStorage.addMessage(conversationId, userMessage);

          // Handle tool calls: add them to context for persistence
          if (currentResponse.toolCalls && currentResponse.toolCalls.length > 0) {
            const hasToolResults = currentResponse.toolCalls.some(tc => tc.result !== undefined);

            if (hasToolResults) {
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
              yield* self.contextStorage.addMessage(conversationId, {
                role: 'assistant',
                content: assistantParts,
              });

              // Add tool results to context
              // Per locked decision: ToolFailure is distinct from ToolResult
              for (let idx = 0; idx < currentResponse.toolCalls.length; idx++) {
                const toolCall = currentResponse.toolCalls[idx];
                if (toolCall.result !== undefined) {
                  if (toolCall.error) {
                    // Persist as ToolFailure record - distinct type with error code + message
                    yield* self.contextStorage.addMessage(conversationId, {
                      role: 'tool',
                      content: [
                        Prompt.makePart('tool-result', {
                          id: toolCallIds[idx],
                          name: toolCall.toolId,
                          result: {
                            __type: 'ToolFailure',
                            error: toolCall.error,
                            output: toolCall.result,
                          },
                          isFailure: true,
                          providerExecuted: false,
                        }),
                      ],
                    });
                  } else {
                    // Persist as ToolResult record - success case
                    yield* self.contextStorage.addMessage(conversationId, {
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
          }

          // Add assistant response to context only if no tool calls were handled
          const toolCallsHandled = currentResponse.toolCalls &&
            currentResponse.toolCalls.length > 0 &&
            currentResponse.toolCalls.some(tc => tc.result !== undefined);

          if (currentResponse.content && !toolCallsHandled) {
            const assistantMessage: Prompt.MessageEncoded = {
              role: 'assistant',
              content: currentResponse.content,
            };
            yield* self.contextStorage.addMessage(conversationId, assistantMessage);
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
          if (previousActiveSpan) {
            tracer?.setActiveSpan(previousActiveSpan);
          } else {
            tracer?.setActiveSpan(undefined);
          }
        }
      }
    });
  }

  streamMessage(
    message: string,
    options?: ProcessingOptions
  ): Stream.Stream<StreamEvent, MessageProcessorError> {
    const self = this;

    return Stream.unwrap(
      Effect.gen(function* () {
        const config = yield* Ref.get(self.config);

        // Validate message input
        try {
          validateMessageLength(message);
        } catch (error) {
          return yield* Effect.fail(
            new MessageValidationError({
              message: 'Message validation failed',
              details: error instanceof Error ? error.message : String(error),
            })
          );
        }

        const requireConversationId = options?.requireConversationId ?? config.memoryDefaults.requireConversationId;
        let conversationId = options?.conversationId;

        if (!conversationId && !requireConversationId) {
          conversationId = yield* self.contextStorage.generateConversationId();
        }

        if (!conversationId) {
          return yield* Effect.fail(new ConversationIdRequiredError({}));
        }

        const useSemantic = options?.useSemanticMatching ?? true;
        const threshold = options?.semanticThreshold ?? 0.6;
        const sequentialVisibility = options?.sequentialVisibility ?? config.memoryDefaults.sequentialVisibility ?? true;

        // Get conversation history
        const history = yield* self.contextStorage.getHistory(conversationId);

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
        const route = yield* self.routeMessage(
          message,
          semanticMatcher,
          sequentialVisibility ? previousMessages : [],
          { conversationId, sequentialVisibility }
        );

        if (route.type === 'none') {
          return yield* Effect.fail(new NoRouteFoundError({ message }));
        }

        // Handle pipeline/intent routes with synthetic events
        if (route.type === 'pipeline' || route.type === 'intent') {
          if (!route.response) {
            return yield* Effect.fail(
              new RouteExecutionError({ routeType: route.type, cause: new Error(`Route type ${route.type} did not return a response`) })
            );
          }

          const userMessage: Prompt.MessageEncoded = {
            role: 'user',
            content: message,
          };
          yield* self.contextStorage.addMessage(conversationId, userMessage);

          const assistantMessage: Prompt.MessageEncoded = {
            role: 'assistant',
            content: route.response.content,
          };
          yield* self.contextStorage.addMessage(conversationId, assistantMessage);

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

        // Handle agent routes with streaming
        if (route.type === 'agent' || route.type === 'default') {
          if (!route.agent) {
            return yield* Effect.fail(
              new RouteExecutionError({ routeType: route.type, cause: new Error(`Route type ${route.type} did not return an agent`) })
            );
          }

          // Create agent stream with handoff support
          return self.createAgentStreamWithHandoff(
            route.agentId!,
            message,
            previousMessages,
            0,
            conversationId,
            sequentialVisibility
          );
        }

        return yield* Effect.fail(
          new RouteExecutionError({ routeType: 'unknown', cause: new Error(`Unknown route type: ${route.type}`) })
        );
      })
    );
  }

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

    return Stream.unwrap(
      Effect.gen(function* () {
        const agent = yield* self.agentService.getAgentOptional(agentId);
        if (!agent) {
          return yield* Effect.fail(new AgentNotFoundError({ agentId }));
        }

        const shouldPersistHistory = agent.config.persistHistory !== false;

        // If agent doesn't have streaming, fall back to processMessage with synthetic events
        if (!agent.streamMessage) {
          if (shouldPersistHistory) {
            yield* self.contextStorage.addMessage(conversationId, {
              role: 'user',
              content: currentMessage,
            });
          }

          const response = yield* Effect.promise(() =>
            agent.processMessage(currentMessage, sequentialVisibility ? previousMessages : [])
          );

          if (response.content && shouldPersistHistory) {
            yield* self.contextStorage.addMessage(conversationId, {
              role: 'assistant',
              content: response.content,
            });
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
            const updatedHistory = yield* self.contextStorage.getHistory(conversationId);
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
          yield* self.contextStorage.addMessage(conversationId, {
            role: 'user',
            content: currentMessage,
          });
        }

        // Track per-step state for persistence
        // Per locked decision: Use separate ToolFailure record type (not isFailure flag)
        type ToolCallState = {
          id: string;
          toolName: string;
          args: Record<string, unknown>;
          result?: unknown;
          /** Error info for failed tools - persisted as separate ToolFailure record */
          error?: {
            code: string;
            message: string;
          };
        };

        type StepState = {
          stepIndex: number;
          text: string;
          toolCalls: ToolCallState[];
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
          Stream.tap((event) => {
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
                // Per OpenAI standard: error field in tool-result event indicates failure
                if (event.error) {
                  toolCall.error = {
                    code: event.error.code,
                    message: event.error.message,
                  };
                }
              }
            }

            // Legacy tool-error event handling (backward compatibility)
            if (event.type === 'tool-error' && 'step' in event) {
              const state = getOrCreateStepState(event.step);
              const toolCall = state.toolCalls.find(tc => tc.id === event.toolCallId);
              if (toolCall) {
                toolCall.result = event.error.message;
                toolCall.error = {
                  code: event.error.name || 'TOOL_EXECUTION_ERROR',
                  message: event.error.message,
                };
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

                  await Effect.runPromise(
                    self.contextStorage.addMessage(conversationId, {
                      role: 'assistant',
                      content: assistantParts,
                    })
                  );

                  // Persist tool results and failures as separate record types
                  // Per locked decision: ToolFailure is distinct from ToolResult
                  for (const tc of state.toolCalls) {
                    if (tc.result !== undefined) {
                      if (tc.error) {
                        // Persist as ToolFailure record - distinct type with error code + message
                        // The error field in the result indicates this is a failure record
                        await Effect.runPromise(
                          self.contextStorage.addMessage(conversationId, {
                            role: 'tool',
                            content: [
                              Prompt.makePart('tool-result', {
                                id: tc.id,
                                name: tc.toolName,
                                // Result contains error message for model to see
                                result: {
                                  __type: 'ToolFailure',
                                  error: tc.error,
                                  output: tc.result,
                                },
                                isFailure: true,
                                providerExecuted: false,
                              }),
                            ],
                          })
                        );
                      } else {
                        // Persist as ToolResult record - success case (clean)
                        await Effect.runPromise(
                          self.contextStorage.addMessage(conversationId, {
                            role: 'tool',
                            content: [
                              Prompt.makePart('tool-result', {
                                id: tc.id,
                                name: tc.toolName,
                                result: tc.result,
                                isFailure: false,
                                providerExecuted: false,
                              }),
                            ],
                          })
                        );
                      }
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
                    await Effect.runPromise(
                      self.contextStorage.addMessage(conversationId, {
                        role: 'assistant',
                        content: remainingText,
                      })
                    );
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
            const allEvents = yield* Stream.runCollect(processedStream);
            const eventsArray = Array.from(allEvents);

            // If no handoff or max depth reached, just return collected events
            if (!detectedHandoff || handoffDepth >= MAX_HANDOFF_DEPTH) {
              if (handoffDepth >= MAX_HANDOFF_DEPTH && detectedHandoff) {
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
            const updatedHistory = yield* self.contextStorage.getHistory(conversationId);
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
                self.createAgentStreamWithHandoff(
                  detectedHandoff.agentId,
                  targetMessage + targetContext,
                  updatedPreviousMessages,
                  handoffDepth + 1,
                  conversationId,
                  sequentialVisibility,
                  detectedHandoff.context
                )
              )
            );
          })
        );

        return streamWithHandoffContinuation as Stream.Stream<StreamEvent, MessageProcessorError, never>;
      })
    ) as Stream.Stream<StreamEvent, MessageProcessorError>;
  }

  processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Effect.Effect<AgentResponse, MessageProcessorError> {
    const self = this;

    return Effect.gen(function* () {
      const config = yield* Ref.get(self.config);

      const requireConversationId = options?.requireConversationId ?? config.memoryDefaults.requireConversationId;
      let conversationId = options?.conversationId;

      if (!conversationId && !requireConversationId) {
        conversationId = yield* self.contextStorage.generateConversationId();
      }

      if (!conversationId) {
        return yield* Effect.fail(new ConversationIdRequiredError({}));
      }

      const modelMessages = messages.map((message) => ({
        role: message.role as Prompt.MessageEncoded['role'],
        content: message.content,
      })) as Prompt.MessageEncoded[];

      // Extract the last user message
      const lastUserMessage = modelMessages[modelMessages.length - 1];
      if (!lastUserMessage || lastUserMessage.role !== 'user') {
        return yield* Effect.fail(
          new MessageValidationError({ message: 'Last message must be from user' })
        );
      }

      const userMessageText = typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage.content);

      // Process through intent system
      return yield* self.processMessage(userMessageText, {
        conversationId,
        useSemanticMatching: options?.useSemanticMatching,
        semanticThreshold: options?.semanticThreshold,
        requireConversationId: options?.requireConversationId,
        sequentialVisibility: options?.sequentialVisibility,
        userId: options?.userId,
        role: options?.role,
        policyMetadata: options?.policyMetadata,
      });
    });
  }

  updateConfig(
    partial: Partial<MessageProcessorConfig>
  ): Effect.Effect<void> {
    return Ref.update(this.config, (current) => ({
      ...current,
      ...partial,
    }));
  }

  getConfig(): Effect.Effect<MessageProcessorConfig> {
    return Ref.get(this.config);
  }
}

/**
 * Live layer for MessageProcessorService
 *
 * This layer requires all dependent services to be provided.
 * Optional services (IntentMatcher, IntentRouter, MessageRouter) can be
 * provided separately using the FromInstance layer factories.
 */
export const MessageProcessorServiceLive = Layer.effect(
  MessageProcessorService,
  Effect.gen(function* () {
    const agentService = yield* AgentService;
    const pipelineService = yield* PipelineService;
    const contextStorage = yield* ContextStorageService;

    // Optional services - use Effect.serviceOption for optional dependencies
    const intentMatcherService = yield* Effect.serviceOption(IntentMatcherService).pipe(
      Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
    );
    const intentRouterService = yield* Effect.serviceOption(IntentRouterService).pipe(
      Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
    );
    const messageRouterService = yield* Effect.serviceOption(MessageRouterService).pipe(
      Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
    );

    const config = yield* Ref.make<MessageProcessorConfig>({
      defaultAgentId: undefined,
      memoryDefaults: {},
      tracer: undefined,
    });

    return new MessageProcessorServiceImpl(
      agentService,
      pipelineService,
      contextStorage,
      intentMatcherService,
      intentRouterService,
      messageRouterService,
      config
    );
  })
);

/**
 * Create a MessageProcessorService layer with initial configuration
 */
export const MessageProcessorServiceLiveWithConfig = (
  initialConfig: Partial<MessageProcessorConfig>
) =>
  Layer.effect(
    MessageProcessorService,
    Effect.gen(function* () {
      const agentService = yield* AgentService;
      const pipelineService = yield* PipelineService;
      const contextStorage = yield* ContextStorageService;

      const intentMatcherService = yield* Effect.serviceOption(IntentMatcherService).pipe(
        Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
      );
      const intentRouterService = yield* Effect.serviceOption(IntentRouterService).pipe(
        Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
      );
      const messageRouterService = yield* Effect.serviceOption(MessageRouterService).pipe(
        Effect.map((option) => option._tag === 'Some' ? option.value : undefined)
      );

      const config = yield* Ref.make<MessageProcessorConfig>({
        defaultAgentId: initialConfig.defaultAgentId,
        memoryDefaults: initialConfig.memoryDefaults ?? {},
        tracer: initialConfig.tracer,
      });

      return new MessageProcessorServiceImpl(
        agentService,
        pipelineService,
        contextStorage,
        intentMatcherService,
        intentRouterService,
        messageRouterService,
        config
      );
    })
  );
