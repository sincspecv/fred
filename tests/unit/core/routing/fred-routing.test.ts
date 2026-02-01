/**
 * Fred routing integration tests
 *
 * Tests Fred.configureRouting(), Fred.testRoute(), and routing integration.
 */

import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { Fred } from '../../../../packages/core/src/index';
import { RoutingConfig } from '../../../../packages/core/src/routing/types';
import { createMockProvider } from '../../helpers/mock-provider';
import { AgentInstance } from '../../../../packages/core/src/agent/agent';

/**
 * Manually add a mock agent to Fred's agent manager for testing.
 * This bypasses the agent creation which requires full provider setup.
 */
function addMockAgent(fred: Fred, agentId: string): void {
  const agentManager = (fred as any).agentManager;
  const agentsMap = agentManager.agents as Map<string, AgentInstance>;
  agentsMap.set(agentId, {
    id: agentId,
    config: {
      id: agentId,
      platform: 'mock',
      model: 'mock-model',
      systemMessage: 'Mock agent',
    },
    processMessage: async () => ({ content: 'Mock response' }),
  } as AgentInstance);
}

describe('Fred Routing Integration', () => {
  let fred: Fred;

  beforeEach(() => {
    fred = new Fred();
  });

  describe('configureRouting', () => {
    it('should set up MessageRouter with config', () => {
      // Add mock agents
      addMockAgent(fred, 'support-agent');
      addMockAgent(fred, 'sales-agent');

      const routingConfig: RoutingConfig = {
        defaultAgent: 'support-agent',
        rules: [
          { id: 'sales-rule', agent: 'sales-agent', keywords: ['pricing', 'buy'] },
        ],
      };

      // Should not throw
      fred.configureRouting(routingConfig);

      // Verify internal state (messageRouter is set)
      expect((fred as any).messageRouter).not.toBeUndefined();
    });
  });

  describe('testRoute', () => {
    it('should return null if routing is not configured', async () => {
      const decision = await fred.testRoute('any message');
      expect(decision).toBeNull();
    });

    it('should return routing decision when configured', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'help-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'help-rule', agent: 'help-agent', keywords: ['help', 'support'] },
        ],
      });

      // Test matching rule
      const helpDecision = await fred.testRoute('I need help');
      expect(helpDecision).not.toBeNull();
      expect(helpDecision?.agent).toBe('help-agent');
      expect(helpDecision?.fallback).toBe(false);
      expect(helpDecision?.matchType).toBe('keyword');

      // Test fallback
      const defaultDecision = await fred.testRoute('hello world');
      expect(defaultDecision).not.toBeNull();
      expect(defaultDecision?.agent).toBe('default-agent');
      expect(defaultDecision?.fallback).toBe(true);
    });

    it('should pass metadata to router', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'vip-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'vip-rule', agent: 'vip-agent', metadata: { tier: 'vip' } },
        ],
      });

      // Test with matching metadata
      const vipDecision = await fred.testRoute('any message', { tier: 'vip' });
      expect(vipDecision).not.toBeNull();
      expect(vipDecision?.agent).toBe('vip-agent');
      expect(vipDecision?.matchType).toBe('metadata-only');

      // Test without matching metadata
      const regularDecision = await fred.testRoute('any message', { tier: 'regular' });
      expect(regularDecision).not.toBeNull();
      expect(regularDecision?.agent).toBe('default-agent');
      expect(regularDecision?.fallback).toBe(true);
    });

    it('should handle regex pattern matching', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'weather-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'weather-rule', agent: 'weather-agent', patterns: ['^weather', 'forecast'] },
        ],
      });

      // Test pattern match
      const weatherDecision = await fred.testRoute('weather in NYC');
      expect(weatherDecision?.agent).toBe('weather-agent');
      expect(weatherDecision?.matchType).toBe('regex');

      // Test another pattern
      const forecastDecision = await fred.testRoute('give me the forecast');
      expect(forecastDecision?.agent).toBe('weather-agent');
    });

    it('should handle function matchers', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'long-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          {
            id: 'long-message',
            agent: 'long-agent',
            matcher: (msg) => msg.length > 50
          },
        ],
      });

      // Short message
      const shortDecision = await fred.testRoute('hi');
      expect(shortDecision?.agent).toBe('default-agent');

      // Long message
      const longDecision = await fred.testRoute('This is a very long message that exceeds fifty characters in length');
      expect(longDecision?.agent).toBe('long-agent');
      expect(longDecision?.matchType).toBe('function');
    });
  });

  describe('fallback behavior', () => {
    it('should use first agent when defaultAgent is not found', async () => {
      addMockAgent(fred, 'first-agent');
      addMockAgent(fred, 'second-agent');

      // Configure with non-existent default
      fred.configureRouting({
        defaultAgent: 'non-existent-agent',
        rules: [],
      });

      // testRoute uses silent mode, so no warning
      const decision = await fred.testRoute('any message');
      expect(decision).not.toBeNull();
      expect(decision?.agent).toBe('first-agent');
      expect(decision?.fallback).toBe(true);
    });

    it('should throw error when no agents are available', async () => {
      fred.configureRouting({
        defaultAgent: 'non-existent',
        rules: [],
      });

      await expect(fred.testRoute('any message')).rejects.toThrow(
        'No agents available for routing'
      );
    });
  });

  describe('routing hooks', () => {
    it('should allow registering routing hooks on Fred', () => {
      let beforeCalled = false;
      let afterCalled = false;

      fred.registerHook('beforeRouting', () => {
        beforeCalled = true;
      });

      fred.registerHook('afterRouting', () => {
        afterCalled = true;
      });

      // Hooks are registered but not called until route() is used
      // testRoute() doesn't call hooks (that's by design)
      expect(beforeCalled).toBe(false);
      expect(afterCalled).toBe(false);
    });
  });

  describe('specificity', () => {
    it('should route to most specific rule', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'keyword-agent');
      addMockAgent(fred, 'regex-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'keyword-rule', agent: 'keyword-agent', keywords: ['help'] },
          { id: 'regex-rule', agent: 'regex-agent', patterns: ['help me'] },
        ],
      });

      // "help me" should match regex (higher specificity than keyword)
      const decision = await fred.testRoute('help me please');
      expect(decision?.agent).toBe('regex-agent');
    });

    it('should respect explicit priority', async () => {
      addMockAgent(fred, 'default-agent');
      addMockAgent(fred, 'low-priority-agent');
      addMockAgent(fred, 'high-priority-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'low', agent: 'low-priority-agent', keywords: ['test'], priority: 10 },
          { id: 'high', agent: 'high-priority-agent', keywords: ['test'], priority: 100 },
        ],
      });

      const decision = await fred.testRoute('test message');
      expect(decision?.agent).toBe('high-priority-agent');
    });
  });

  describe('persistHistory opt-out', () => {
    it('should leave history empty when default agent has persistHistory=false', async () => {
      // Add agent with persistHistory=false
      const agentManager = (fred as any).agentManager;
      const agentsMap = agentManager.agents as Map<string, AgentInstance>;
      agentsMap.set('no-persist-agent', {
        id: 'no-persist-agent',
        config: {
          id: 'no-persist-agent',
          platform: 'mock',
          model: 'mock-model',
          systemMessage: 'Mock agent',
          persistHistory: false,
        },
        processMessage: async () => ({ content: 'Response from no-persist agent' }),
      } as AgentInstance);

      fred.configureRouting({
        defaultAgent: 'no-persist-agent',
        rules: [],
      });

      const contextManager = fred.getContextManager();
      const conversationId = contextManager.generateConversationId();

      await fred.processMessage('Hello', { conversationId });

      const history = await contextManager.getHistory(conversationId);
      expect(history).toHaveLength(0);
    });

    it('should persist history when agent has persistHistory=true (default)', async () => {
      // Add agent with default persistHistory (true)
      const agentManager = (fred as any).agentManager;
      const agentsMap = agentManager.agents as Map<string, AgentInstance>;
      agentsMap.set('persist-agent', {
        id: 'persist-agent',
        config: {
          id: 'persist-agent',
          platform: 'mock',
          model: 'mock-model',
          systemMessage: 'Mock agent',
          // persistHistory not set, defaults to true
        },
        processMessage: async () => ({ content: 'Response from persist agent' }),
      } as AgentInstance);

      fred.configureRouting({
        defaultAgent: 'persist-agent',
        rules: [],
      });

      const contextManager = fred.getContextManager();
      const conversationId = contextManager.generateConversationId();

      await fred.processMessage('Hello', { conversationId });

      const history = await contextManager.getHistory(conversationId);
      expect(history.length).toBeGreaterThan(0);
      expect(history.some(msg => msg.role === 'user')).toBe(true);
      expect(history.some(msg => msg.role === 'assistant')).toBe(true);
    });
  });
});
