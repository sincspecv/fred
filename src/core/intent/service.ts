/**
 * Effect services for Intent matching and routing
 *
 * These services provide Effect-native interfaces wrapping the
 * IntentMatcher and IntentRouter classes.
 */

import { Context, Effect, Layer } from 'effect';
import type { Intent, IntentMatch } from './intent';
import { IntentMatcher, createIntentMatcher } from './matcher';
import { IntentRouter, createIntentRouter } from './router';
import type { AgentResponse, AgentMessage } from '../agent/agent';
import { AgentService } from '../agent/service';
import type { IntentMatchError, ActionHandlerNotFoundError, DefaultAgentNotConfiguredError, IntentRouteError } from './errors';

/**
 * Semantic matcher function type
 */
export type SemanticMatcherFn = (
  message: string,
  utterances: string[]
) => Promise<{ matched: boolean; confidence: number; utterance?: string }>;

/**
 * IntentMatcherService interface
 */
export interface IntentMatcherService {
  matchIntent(
    message: string,
    semanticMatcher?: SemanticMatcherFn
  ): Effect.Effect<IntentMatch | null, IntentMatchError>;

  registerIntents(intents: Intent[]): Effect.Effect<void>;

  getIntents(): Effect.Effect<Intent[]>;

  clear(): Effect.Effect<void>;
}

export const IntentMatcherService = Context.GenericTag<IntentMatcherService>(
  'IntentMatcherService'
);

/**
 * IntentMatcherService implementation using IntentMatcher
 */
class IntentMatcherServiceImpl implements IntentMatcherService {
  constructor(private matcher: IntentMatcher) {}

  matchIntent(
    message: string,
    semanticMatcher?: SemanticMatcherFn
  ): Effect.Effect<IntentMatch | null, IntentMatchError> {
    return this.matcher.matchIntent(message, semanticMatcher);
  }

  registerIntents(intents: Intent[]): Effect.Effect<void> {
    return this.matcher.registerIntents(intents);
  }

  getIntents(): Effect.Effect<Intent[]> {
    return this.matcher.getIntents();
  }

  clear(): Effect.Effect<void> {
    return this.matcher.clear();
  }
}

/**
 * Live layer for IntentMatcherService
 */
export const IntentMatcherServiceLive = Layer.effect(
  IntentMatcherService,
  Effect.gen(function* () {
    const matcher = yield* createIntentMatcher();
    return new IntentMatcherServiceImpl(matcher);
  })
);

/**
 * IntentRouterService interface
 */
export interface IntentRouterService {
  routeIntent(
    match: IntentMatch,
    userMessage: string
  ): Effect.Effect<AgentResponse, ActionHandlerNotFoundError | IntentRouteError>;

  routeToDefaultAgent(
    userMessage: string,
    previousMessages?: AgentMessage[]
  ): Effect.Effect<AgentResponse, DefaultAgentNotConfiguredError | IntentRouteError>;

  setDefaultAgent(agentId: string): Effect.Effect<void>;
}

export const IntentRouterService = Context.GenericTag<IntentRouterService>(
  'IntentRouterService'
);

/**
 * IntentRouterService implementation using IntentRouter
 */
class IntentRouterServiceImpl implements IntentRouterService {
  constructor(private router: IntentRouter) {}

  routeIntent(
    match: IntentMatch,
    userMessage: string
  ): Effect.Effect<AgentResponse, ActionHandlerNotFoundError | IntentRouteError> {
    return this.router.routeIntent(match, userMessage);
  }

  routeToDefaultAgent(
    userMessage: string,
    previousMessages?: AgentMessage[]
  ): Effect.Effect<AgentResponse, DefaultAgentNotConfiguredError | IntentRouteError> {
    return this.router.routeToDefaultAgent(userMessage, previousMessages);
  }

  setDefaultAgent(agentId: string): Effect.Effect<void> {
    return this.router.setDefaultAgent(agentId);
  }
}

/**
 * Live layer for IntentRouterService
 * Depends on AgentService
 */
export const IntentRouterServiceLive = Layer.effect(
  IntentRouterService,
  Effect.gen(function* () {
    const agentService = yield* AgentService;
    const router = yield* createIntentRouter(agentService);
    return new IntentRouterServiceImpl(router);
  })
);

/**
 * Create IntentMatcherService from an existing IntentMatcher instance
 * (for backward compatibility during migration)
 */
export const IntentMatcherServiceFromInstance = (
  matcher: IntentMatcher
): Layer.Layer<IntentMatcherService> =>
  Layer.succeed(IntentMatcherService, new IntentMatcherServiceImpl(matcher));

/**
 * Create IntentRouterService from an existing IntentRouter instance
 * (for backward compatibility during migration)
 */
export const IntentRouterServiceFromInstance = (
  router: IntentRouter
): Layer.Layer<IntentRouterService> =>
  Layer.succeed(IntentRouterService, new IntentRouterServiceImpl(router));
