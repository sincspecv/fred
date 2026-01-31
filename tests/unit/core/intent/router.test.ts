import { describe, test, expect, beforeEach } from 'bun:test';
import { Effect, Exit, Ref, Layer, Context } from 'effect';
import { IntentRouter, createIntentRouter } from '../../../../src/core/intent/router';
import { AgentService } from '../../../../src/core/agent/service';
import { IntentMatch, Action } from '../../../../src/core/intent/intent';
import { createMockAgent } from '../../helpers/mock-agent';
import type { AgentInstance } from '../../../../src/core/agent/agent';

describe('IntentRouter', () => {
  // Map to store mock agents
  let mockAgents: Map<string, AgentInstance>;

  // Create a mock AgentService that returns Effect types
  const createMockAgentService = (): typeof AgentService.Service => ({
    createAgent: () => Effect.fail({ _tag: 'AgentCreationError' as const, message: 'Not implemented' } as any),
    getAgent: (id: string) => {
      const agent = mockAgents.get(id);
      if (agent) return Effect.succeed(agent);
      return Effect.fail({ _tag: 'AgentNotFoundError' as const, agentId: id } as any);
    },
    getAgentOptional: (id: string) => Effect.succeed(mockAgents.get(id)),
    hasAgent: (id: string) => Effect.succeed(mockAgents.has(id)),
    removeAgent: () => Effect.succeed(true),
    getAllAgents: () => Effect.succeed(Array.from(mockAgents.values())),
    clear: () => Effect.succeed(undefined),
    setTracer: () => Effect.succeed(undefined),
    setDefaultSystemMessage: () => Effect.succeed(undefined),
    setGlobalVariablesResolver: () => Effect.succeed(undefined),
    matchAgentByUtterance: () => Effect.succeed(null),
    getMcpMetrics: () => Effect.succeed({ connections: 0, tools: 0, resources: 0, prompts: 0, connectionDetails: [] }),
  });

  // Helper to create router using factory
  const createTestRouter = async (): Promise<IntentRouter> => {
    const mockService = createMockAgentService();
    return Effect.runPromise(createIntentRouter(mockService));
  };

  beforeEach(() => {
    mockAgents = new Map();
  });

  function createIntentMatch(intentId: string, actionType: 'agent' | 'function', target: string): IntentMatch {
    return {
      intent: {
        id: intentId,
        utterances: ['test'],
        action: {
          type: actionType,
          target,
        },
      },
      confidence: 1.0,
      matchType: 'exact',
    };
  }

  describe('setDefaultAgent', () => {
    test('should set default agent ID', async () => {
      const router = await createTestRouter();

      // setDefaultAgent returns Effect<void>, should not throw
      await Effect.runPromise(router.setDefaultAgent('default-agent'));
      // If we get here without error, the test passes
      expect(true).toBe(true);
    });
  });

  describe('registerActionHandler', () => {
    test('should register custom action handler', async () => {
      const router = await createTestRouter();

      const customHandler = (action: Action, payload?: any) => {
        return Effect.succeed({ result: 'custom handler', action, payload });
      };

      await Effect.runPromise(router.registerActionHandler('custom', customHandler));

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;

      const result = await Effect.runPromise(router.routeIntent(match, 'test message'));
      expect(result.result).toBe('custom handler');
    });

    test('should override existing handler', async () => {
      const router = await createTestRouter();

      const handler1 = () => Effect.succeed({ result: 'handler1' });
      const handler2 = () => Effect.succeed({ result: 'handler2' });

      await Effect.runPromise(router.registerActionHandler('custom', handler1));
      await Effect.runPromise(router.registerActionHandler('custom', handler2));

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;

      const result = await Effect.runPromise(router.routeIntent(match, 'test message'));
      expect(result.result).toBe('handler2');
    });
  });

  describe('routeIntent', () => {
    test('should route to agent action', async () => {
      const agent = createMockAgent('test-agent');
      mockAgents.set('test-agent', agent);

      const router = await createTestRouter();
      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await Effect.runPromise(router.routeIntent(match, 'hello'));

      expect(result).toBeDefined();
      expect(result.content).toContain('hello');
    });

    test('should pass user message and match to handler', async () => {
      const agent = createMockAgent('test-agent');
      mockAgents.set('test-agent', agent);

      const router = await createTestRouter();
      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await Effect.runPromise(router.routeIntent(match, 'test message'));

      expect(result.content).toContain('test message');
    });

    test('should pass action payload to handler', async () => {
      const router = await createTestRouter();

      const customHandler = (action: Action, payload?: any) => {
        return Effect.succeed({ payload });
      };

      await Effect.runPromise(router.registerActionHandler('custom', customHandler));

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;
      match.intent.action.payload = { custom: 'data' };

      const result = await Effect.runPromise(router.routeIntent(match, 'test message'));
      expect(result.payload.userMessage).toBe('test message');
      expect(result.payload.match).toBe(match);
      expect(result.payload.custom).toBe('data');
    });

    test('should fail when handler not found', async () => {
      const router = await createTestRouter();

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'nonexistent' as any;

      const exit = await Effect.runPromiseExit(router.routeIntent(match, 'test'));
      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        const error = exit.cause;
        // The error should be ActionHandlerNotFoundError
        expect(error).toBeDefined();
      }
    });

    test('should fail when agent not found in agent action', async () => {
      const router = await createTestRouter();

      const match = createIntentMatch('test-intent', 'agent', 'nonexistent-agent');

      const exit = await Effect.runPromiseExit(router.routeIntent(match, 'test'));
      expect(Exit.isFailure(exit)).toBe(true);
    });

    test('should fail for function action (not implemented)', async () => {
      const router = await createTestRouter();

      const match = createIntentMatch('test-intent', 'function', 'test-function');

      const exit = await Effect.runPromiseExit(router.routeIntent(match, 'test'));
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe('routeToDefaultAgent', () => {
    test('should route to default agent', async () => {
      const agent = createMockAgent('default-agent');
      mockAgents.set('default-agent', agent);

      const router = await createTestRouter();
      await Effect.runPromise(router.setDefaultAgent('default-agent'));

      const result = await Effect.runPromise(router.routeToDefaultAgent('hello'));

      expect(result).toBeDefined();
      expect(result.content).toContain('hello');
    });

    test('should pass previous messages to agent', async () => {
      const agent = createMockAgent('default-agent');
      mockAgents.set('default-agent', agent);

      const router = await createTestRouter();
      await Effect.runPromise(router.setDefaultAgent('default-agent'));

      const previousMessages = [
        { role: 'user' as const, content: 'previous message' },
      ];

      const result = await Effect.runPromise(router.routeToDefaultAgent('hello', previousMessages));
      expect(result).toBeDefined();
    });

    test('should fail when no default agent set', async () => {
      const router = await createTestRouter();

      const exit = await Effect.runPromiseExit(router.routeToDefaultAgent('test'));
      expect(Exit.isFailure(exit)).toBe(true);
    });

    test('should fail when default agent not found', async () => {
      const router = await createTestRouter();
      await Effect.runPromise(router.setDefaultAgent('nonexistent-agent'));

      const exit = await Effect.runPromiseExit(router.routeToDefaultAgent('test'));
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe('default action handlers', () => {
    test('should have agent handler registered by default', async () => {
      const agent = createMockAgent('test-agent');
      mockAgents.set('test-agent', agent);

      const router = await createTestRouter();
      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await Effect.runPromise(router.routeIntent(match, 'test'));

      expect(result).toBeDefined();
    });

    test('should have function handler registered by default (fails)', async () => {
      const router = await createTestRouter();
      const match = createIntentMatch('test-intent', 'function', 'test-function');

      const exit = await Effect.runPromiseExit(router.routeIntent(match, 'test'));
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
