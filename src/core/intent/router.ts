import { Effect, Ref } from 'effect';
import { IntentMatch, Action } from './intent';
import {
  ActionHandlerNotFoundError,
  DefaultAgentNotConfiguredError,
  IntentRouteError,
} from './errors';
import type { AgentMessage, AgentResponse } from '../agent/agent';
import { AgentService } from '../agent/service';

type ActionHandler = (action: Action, payload?: any) => Effect.Effect<any, IntentRouteError>;

/**
 * Action executor for routing intents to actions
 */
export class IntentRouter {
  private actionHandlers: Ref.Ref<Map<string, ActionHandler>>;
  private defaultAgentId: Ref.Ref<string | undefined>;
  private agentService: typeof AgentService.Service;

  constructor(
    actionHandlersRef: Ref.Ref<Map<string, ActionHandler>>,
    defaultAgentIdRef: Ref.Ref<string | undefined>,
    agentService: typeof AgentService.Service
  ) {
    this.actionHandlers = actionHandlersRef;
    this.defaultAgentId = defaultAgentIdRef;
    this.agentService = agentService;
  }

  /**
   * Set the default agent ID for fallback routing
   */
  setDefaultAgent(agentId: string): Effect.Effect<void> {
    return Ref.set(this.defaultAgentId, agentId);
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(
    type: string,
    handler: ActionHandler
  ): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const handlers = yield* Ref.get(self.actionHandlers);
      const newHandlers = new Map(handlers);
      newHandlers.set(type, handler);
      yield* Ref.set(self.actionHandlers, newHandlers);
    });
  }

  /**
   * Route an intent match to its action
   */
  routeIntent(
    match: IntentMatch,
    userMessage: string
  ): Effect.Effect<any, ActionHandlerNotFoundError | IntentRouteError> {
    const self = this;
    return Effect.gen(function* () {
      const { intent } = match;
      const handlers = yield* Ref.get(self.actionHandlers);
      const handler = handlers.get(intent.action.type);

      if (!handler) {
        return yield* Effect.fail(
          new ActionHandlerNotFoundError({ actionType: intent.action.type })
        );
      }

      return yield* handler(intent.action, {
        userMessage,
        match,
        ...intent.action.payload,
      });
    });
  }

  /**
   * Route to default agent when no intent matches
   */
  routeToDefaultAgent(
    userMessage: string,
    previousMessages?: AgentMessage[]
  ): Effect.Effect<any, DefaultAgentNotConfiguredError | IntentRouteError> {
    const self = this;
    return Effect.gen(function* () {
      const defaultAgentId = yield* Ref.get(self.defaultAgentId);

      if (!defaultAgentId) {
        return yield* Effect.fail(
          new DefaultAgentNotConfiguredError({
            message: 'No default agent configured. Set a default agent or ensure an intent matches.'
          })
        );
      }

      const agent = yield* self.agentService.getAgentOptional(defaultAgentId);

      if (!agent) {
        return yield* Effect.fail(
          new IntentRouteError({
            intentId: 'default',
            cause: new Error(`Default agent not found: ${defaultAgentId}`)
          })
        );
      }

      return yield* Effect.tryPromise({
        try: () => agent.processMessage(userMessage, previousMessages),
        catch: (error) => new IntentRouteError({
          intentId: 'default',
          cause: error instanceof Error ? error : new Error(String(error))
        })
      });
    });
  }

  /**
   * Handle agent action - route message to an agent
   */
  private handleAgentAction(
    action: Action,
    payload: any
  ): Effect.Effect<any, IntentRouteError> {
    const self = this;
    return Effect.gen(function* () {
      const agent = yield* self.agentService.getAgentOptional(action.target);

      if (!agent) {
        return yield* Effect.fail(
          new IntentRouteError({
            intentId: payload.match?.intent?.id || 'unknown',
            cause: new Error(`Agent not found: ${action.target}`)
          })
        );
      }

      const messages: AgentMessage[] = payload.previousMessages || [];
      return yield* Effect.tryPromise({
        try: () => agent.processMessage(payload.userMessage, messages),
        catch: (error) => new IntentRouteError({
          intentId: payload.match?.intent?.id || 'unknown',
          cause: error instanceof Error ? error : new Error(String(error))
        })
      });
    });
  }

  /**
   * Handle function action - execute a custom function
   */
  private handleFunctionAction(
    action: Action,
    payload: any
  ): Effect.Effect<any, IntentRouteError> {
    return Effect.fail(
      new IntentRouteError({
        intentId: payload.match?.intent?.id || 'unknown',
        cause: new Error(`Function action handler not implemented. Function: ${action.target}`)
      })
    );
  }
}

/**
 * Create an IntentRouter synchronously for backward compatibility.
 * Uses AgentManager adapter instead of AgentService.
 */
export const createIntentRouterSync = (
  agentManager: { getAgent: (id: string) => any }
): IntentRouter => {
  const handlersRef = Ref.unsafeMake(new Map<string, ActionHandler>());
  const defaultAgentIdRef = Ref.unsafeMake<string | undefined>(undefined);

  // Create a minimal AgentService adapter from AgentManager
  const agentServiceAdapter = {
    getAgentOptional: (id: string) => Effect.sync(() => agentManager.getAgent(id)),
    // Add other methods as needed
  } as unknown as typeof AgentService.Service;

  const router = new IntentRouter(handlersRef, defaultAgentIdRef, agentServiceAdapter);

  // Register default action handlers synchronously
  Effect.runSync(router.registerActionHandler('agent', (action, payload) =>
    router['handleAgentAction'](action, payload)
  ));
  Effect.runSync(router.registerActionHandler('function', (action, payload) =>
    router['handleFunctionAction'](action, payload)
  ));

  return router;
};

/**
 * Create an IntentRouter with default action handlers registered
 */
export const createIntentRouter = (
  agentService: typeof AgentService.Service
): Effect.Effect<IntentRouter> =>
  Effect.gen(function* () {
    const handlersRef = yield* Ref.make(new Map<string, ActionHandler>());
    const defaultAgentIdRef = yield* Ref.make<string | undefined>(undefined);

    const router = new IntentRouter(handlersRef, defaultAgentIdRef, agentService);

    // Register default action handlers
    yield* router.registerActionHandler('agent', (action, payload) =>
      router['handleAgentAction'](action, payload)
    );
    yield* router.registerActionHandler('function', (action, payload) =>
      router['handleFunctionAction'](action, payload)
    );

    return router;
  });
