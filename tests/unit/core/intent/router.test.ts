import { describe, test, expect, beforeEach } from 'bun:test';
import { IntentRouter } from '../../../../src/core/intent/router';
import { AgentManager } from '../../../../src/core/agent/manager';
import { ToolRegistry } from '../../../../src/core/tool/registry';
import { IntentMatch, Intent, Action } from '../../../../src/core/intent/intent';
import { createMockAgent } from '../../helpers/mock-agent';

describe('IntentRouter', () => {
  let router: IntentRouter;
  let agentManager: AgentManager;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    agentManager = new AgentManager(toolRegistry);
    router = new IntentRouter(agentManager);
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
    test('should set default agent ID', () => {
      router.setDefaultAgent('default-agent');
      // Can't directly test private field, but we can test via routeToDefaultAgent
      expect(() => router.setDefaultAgent('default-agent')).not.toThrow();
    });
  });

  describe('registerActionHandler', () => {
    test('should register custom action handler', async () => {
      const customHandler = async (action: Action, payload?: any) => {
        return { result: 'custom handler', action, payload };
      };

      router.registerActionHandler('custom', customHandler);

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;

      const result = await router.routeIntent(match, 'test message');
      expect(result.result).toBe('custom handler');
    });

    test('should override existing handler', async () => {
      const handler1 = async () => ({ result: 'handler1' });
      const handler2 = async () => ({ result: 'handler2' });

      router.registerActionHandler('custom', handler1);
      router.registerActionHandler('custom', handler2);

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;

      const result = await router.routeIntent(match, 'test message');
      expect(result.result).toBe('handler2');
    });
  });

  describe('routeIntent', () => {
    test('should route to agent action', async () => {
      const agent = createMockAgent('test-agent');
      agentManager['agents'].set('test-agent', agent);

      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await router.routeIntent(match, 'hello');

      expect(result).toBeDefined();
      expect(result.content).toContain('hello');
    });

    test('should pass user message and match to handler', async () => {
      const agent = createMockAgent('test-agent');
      agentManager['agents'].set('test-agent', agent);

      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await router.routeIntent(match, 'test message');

      expect(result.content).toContain('test message');
    });

    test('should pass action payload to handler', async () => {
      const customHandler = async (action: Action, payload?: any) => {
        return { payload };
      };

      router.registerActionHandler('custom', customHandler);

      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'custom' as any;
      match.intent.action.payload = { custom: 'data' };

      const result = await router.routeIntent(match, 'test message');
      expect(result.payload.userMessage).toBe('test message');
      expect(result.payload.match).toBe(match);
      expect(result.payload.custom).toBe('data');
    });

    test('should throw error when handler not found', async () => {
      const match = createIntentMatch('test-intent', 'function', 'test');
      match.intent.action.type = 'nonexistent' as any;

      await expect(router.routeIntent(match, 'test')).rejects.toThrow(
        'No handler registered for action type: nonexistent'
      );
    });

    test('should throw error when agent not found in agent action', async () => {
      const match = createIntentMatch('test-intent', 'agent', 'nonexistent-agent');

      await expect(router.routeIntent(match, 'test')).rejects.toThrow('Agent not found: nonexistent-agent');
    });

    test('should throw error for function action (not implemented)', async () => {
      const match = createIntentMatch('test-intent', 'function', 'test-function');

      await expect(router.routeIntent(match, 'test')).rejects.toThrow(
        'Function action handler not implemented. Function: test-function'
      );
    });
  });

  describe('routeToDefaultAgent', () => {
    test('should route to default agent', async () => {
      const agent = createMockAgent('default-agent');
      agentManager['agents'].set('default-agent', agent);
      router.setDefaultAgent('default-agent');

      const result = await router.routeToDefaultAgent('hello');

      expect(result).toBeDefined();
      expect(result.content).toContain('hello');
    });

    test('should pass previous messages to agent', async () => {
      const agent = createMockAgent('default-agent');
      agentManager['agents'].set('default-agent', agent);
      router.setDefaultAgent('default-agent');

      const previousMessages = [
        { role: 'user' as const, content: 'previous message' },
      ];

      const result = await router.routeToDefaultAgent('hello', previousMessages);
      expect(result).toBeDefined();
    });

    test('should throw error when no default agent set', async () => {
      await expect(router.routeToDefaultAgent('test')).rejects.toThrow(
        'No default agent configured. Set a default agent or ensure an intent matches.'
      );
    });

    test('should throw error when default agent not found', async () => {
      router.setDefaultAgent('nonexistent-agent');

      await expect(router.routeToDefaultAgent('test')).rejects.toThrow(
        'Default agent not found: nonexistent-agent'
      );
    });
  });

  describe('default action handlers', () => {
    test('should have agent handler registered by default', async () => {
      const agent = createMockAgent('test-agent');
      agentManager['agents'].set('test-agent', agent);

      const match = createIntentMatch('test-intent', 'agent', 'test-agent');
      const result = await router.routeIntent(match, 'test');

      expect(result).toBeDefined();
    });

    test('should have function handler registered by default (throws)', async () => {
      const match = createIntentMatch('test-intent', 'function', 'test-function');

      await expect(router.routeIntent(match, 'test')).rejects.toThrow(
        'Function action handler not implemented'
      );
    });
  });
});
