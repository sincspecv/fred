/**
 * Effect service for MessageRouter
 *
 * This service provides an Effect-native interface wrapping the
 * MessageRouter class.
 */

import { Context, Effect, Layer } from 'effect';
import { MessageRouter } from './router';
import type { RoutingDecision, RoutingConfig } from './types';
import type { NoAgentsAvailableError } from './errors';
import { AgentManager } from '../agent/manager';
import { HookManager } from '../hooks/manager';

/**
 * MessageRouterService interface
 */
export interface MessageRouterService {
  route(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;

  testRoute(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;

  getFallbackAgent(): Effect.Effect<string, NoAgentsAvailableError>;
}

export const MessageRouterService = Context.GenericTag<MessageRouterService>(
  'MessageRouterService'
);

/**
 * MessageRouterService implementation using MessageRouter
 */
class MessageRouterServiceImpl implements MessageRouterService {
  constructor(private router: MessageRouter) {}

  route(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    return this.router.route(message, metadata);
  }

  testRoute(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    return this.router.testRoute(message, metadata);
  }

  getFallbackAgent(): Effect.Effect<string, NoAgentsAvailableError> {
    // Use the Effect version of getFallbackAgent
    return this.router['getFallbackAgentEffect']();
  }
}

/**
 * Create MessageRouterService from an existing MessageRouter instance
 * (for use when MessageRouter is created externally)
 */
export const MessageRouterServiceFromInstance = (
  router: MessageRouter
): Layer.Layer<MessageRouterService> =>
  Layer.succeed(MessageRouterService, new MessageRouterServiceImpl(router));

/**
 * Create a MessageRouterService layer with configuration
 *
 * Note: This requires AgentManager and HookManager to be provided externally
 * since MessageRouter is typically created during Fred initialization.
 */
export const MessageRouterServiceLive = (
  agentManager: AgentManager,
  hookManager: HookManager | undefined,
  config: RoutingConfig
): Layer.Layer<MessageRouterService> =>
  Layer.succeed(
    MessageRouterService,
    new MessageRouterServiceImpl(
      new MessageRouter(agentManager, hookManager, config)
    )
  );
