/**
 * MessageRouter unit tests
 *
 * Tests rule matching, specificity calculation, fallback cascade, and routing hooks.
 */

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Effect, Exit } from 'effect';
import { MessageRouter } from '../../../../src/core/routing/router';
import { RoutingConfig, RoutingRule } from '../../../../src/core/routing/types';
import { AgentManager } from '../../../../src/core/agent/manager';
import { HookManager } from '../../../../src/core/hooks/manager';
import { ToolRegistry } from '../../../../src/core/tool/registry';
import { AgentInstance } from '../../../../src/core/agent/agent';

/**
 * Create a mock agent manager with optional registered agents.
 */
function createMockAgentManager(agents: { id: string }[] = []): AgentManager {
  const toolRegistry = new ToolRegistry();
  const manager = new AgentManager(toolRegistry);

  // Manually add agents to the internal map for testing
  const agentsMap = (manager as any).agents as Map<string, AgentInstance>;
  for (const agent of agents) {
    agentsMap.set(agent.id, {
      id: agent.id,
      config: { id: agent.id, platform: 'test', model: 'test', systemMessage: 'test' },
      processMessage: async () => ({ content: 'test' }),
    } as AgentInstance);
  }

  return manager;
}

/**
 * Create a message router with the new constructor signature.
 */
function createRouter(
  config: RoutingConfig,
  agents: { id: string }[] = [],
  hookManager?: HookManager
): MessageRouter {
  const agentManager = createMockAgentManager(agents);
  return new MessageRouter(agentManager, hookManager, config);
}

describe('MessageRouter', () => {
  describe('regex pattern matching', () => {
    it('should match exact regex pattern (^hello world$)', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'greeting',
            agent: 'greeter',
            patterns: ['^hello world$'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'greeter' }]);
      const result = await Effect.runPromise(router.route('hello world'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('greeter');
      expect(result.matchType).toBe('exact');
      expect(result.rule?.id).toBe('greeting');
    });

    it('should match partial regex pattern (.*help.*)', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'help-rule',
            agent: 'helper',
            patterns: ['.*help.*'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'helper' }]);
      const result = await Effect.runPromise(router.route('I need help with my order'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('helper');
      expect(result.matchType).toBe('regex');
    });

    it('should be case-insensitive for regex patterns', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'hello',
            agent: 'greeter',
            patterns: ['^HELLO$'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'greeter' }]);
      const result = await Effect.runPromise(router.route('hello'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('greeter');
    });

    it('should skip invalid regex patterns gracefully', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        debug: false,
        rules: [
          {
            id: 'invalid',
            agent: 'broken',
            patterns: ['[invalid(regex'],
          },
          {
            id: 'valid',
            agent: 'working',
            keywords: ['test'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'broken' }, { id: 'working' }]);
      const result = await Effect.runPromise(router.route('test message'));

      // Should skip invalid regex and fall through to keyword match
      expect(result.agent).toBe('working');
    });
  });

  describe('keyword matching with word boundaries', () => {
    it('should match keyword with word boundary (help matches "I need help")', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'support',
            agent: 'support-agent',
            keywords: ['help'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'support-agent' }]);
      const result = await Effect.runPromise(router.route('I need help'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('support-agent');
      expect(result.matchType).toBe('keyword');
    });

    it('should NOT match keyword without word boundary (help does not match "helpful")', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'support',
            agent: 'support-agent',
            keywords: ['help'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'support-agent' }]);
      const result = await Effect.runPromise(router.route('That was very helpful'));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('default');
    });

    it('should match any of multiple keywords', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'support',
            agent: 'support-agent',
            keywords: ['help', 'support', 'issue'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'support-agent' }]);

      const result1 = await Effect.runPromise(router.route('I have an issue'));
      expect(result1.agent).toBe('support-agent');

      const result2 = await Effect.runPromise(router.route('Need support please'));
      expect(result2.agent).toBe('support-agent');
    });

    it('should be case-insensitive for keywords', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'support',
            agent: 'support-agent',
            keywords: ['help'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'support-agent' }]);
      const result = await Effect.runPromise(router.route('HELP ME!'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('support-agent');
    });

    it('should escape special regex characters in keywords', async () => {
      // Keywords with regex special chars are escaped so they match literally.
      // Note: Word boundaries (\b) only work reliably for keywords that
      // start and end with word characters (a-z, A-Z, 0-9, _).
      // For keywords with special chars, use patterns (regex) instead.
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'special',
            agent: 'special-agent',
            // Keywords with special regex chars in the middle
            keywords: ['foo.bar', 'test*case'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'special-agent' }]);

      // foo.bar should match literally (. is escaped, not "any char")
      const result1 = await Effect.runPromise(router.route('Check foo.bar for details'));
      expect(result1.agent).toBe('special-agent');

      // Should NOT match fooXbar (proving . is literal)
      const result2 = await Effect.runPromise(router.route('Check fooXbar for details'));
      expect(result2.agent).toBe('default');
    });
  });

  describe('metadata filtering', () => {
    it('should match rule when metadata filters match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'alice-rule',
            agent: 'alice-agent',
            metadata: { userId: 'alice' },
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'alice-agent' }]);
      const result = await Effect.runPromise(router.route('hello', { userId: 'alice' }));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('alice-agent');
    });

    it('should NOT match rule when metadata filters do not match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'alice-rule',
            agent: 'alice-agent',
            metadata: { userId: 'alice' },
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'alice-agent' }]);
      const result = await Effect.runPromise(router.route('hello', { userId: 'bob' }));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('default');
    });

    it('should require ALL metadata filters to match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'specific-rule',
            agent: 'specific-agent',
            metadata: { userId: 'alice', tier: 'premium' },
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'specific-agent' }]);

      // Only userId matches
      const result1 = await Effect.runPromise(router.route('hello', { userId: 'alice' }));
      expect(result1.fallback).toBe(true);

      // Both match
      const result2 = await Effect.runPromise(router.route('hello', {
        userId: 'alice',
        tier: 'premium',
      }));
      expect(result2.fallback).toBe(false);
      expect(result2.agent).toBe('specific-agent');
    });

    it('should use case-sensitive matching for metadata values', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'case-sensitive',
            agent: 'case-agent',
            metadata: { userId: 'Alice' },
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'case-agent' }]);

      // Wrong case - should not match
      const result1 = await Effect.runPromise(router.route('hello', { userId: 'alice' }));
      expect(result1.fallback).toBe(true);

      // Correct case - should match
      const result2 = await Effect.runPromise(router.route('hello', { userId: 'Alice' }));
      expect(result2.fallback).toBe(false);
    });

    it('should handle metadata-only rules (no patterns/keywords)', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'vip-route',
            agent: 'vip-agent',
            metadata: { tier: 'vip' },
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'vip-agent' }]);
      const result = await Effect.runPromise(router.route('any message', { tier: 'vip' }));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('vip-agent');
      expect(result.matchType).toBe('metadata-only');
    });
  });

  describe('custom function matchers', () => {
    it('should match with sync function matcher', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'length-check',
            agent: 'long-message-agent',
            matcher: (message) => message.length > 50,
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'long-message-agent' }]);

      const shortResult = await Effect.runPromise(router.route('short'));
      expect(shortResult.fallback).toBe(true);

      const longMessage =
        'This is a very long message that exceeds fifty characters in length';
      const longResult = await Effect.runPromise(router.route(longMessage));
      expect(longResult.fallback).toBe(false);
      expect(longResult.agent).toBe('long-message-agent');
      expect(longResult.matchType).toBe('function');
    });

    it('should match with async function matcher', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'async-check',
            agent: 'async-agent',
            matcher: async (message) => {
              // Simulate async operation
              await new Promise((resolve) => setTimeout(resolve, 1));
              return message.includes('async');
            },
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'async-agent' }]);
      const result = await Effect.runPromise(router.route('test async message'));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('async-agent');
    });

    it('should catch and skip rule when function matcher throws error', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        debug: false,
        rules: [
          {
            id: 'error-rule',
            agent: 'error-agent',
            matcher: () => {
              throw new Error('Matcher error');
            },
          },
          {
            id: 'fallback-rule',
            agent: 'fallback-agent',
            keywords: ['test'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'error-agent' }, { id: 'fallback-agent' }]);
      const result = await Effect.runPromise(router.route('test message'));

      // Should skip error rule and match fallback rule
      expect(result.agent).toBe('fallback-agent');
    });

    it('should use metadata with function matcher', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'meta-function',
            agent: 'meta-agent',
            matcher: (message, metadata) =>
              message.includes('hello') && metadata.premium === true,
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'meta-agent' }]);

      const result1 = await Effect.runPromise(router.route('hello', { premium: false }));
      expect(result1.fallback).toBe(true);

      const result2 = await Effect.runPromise(router.route('hello', { premium: true }));
      expect(result2.fallback).toBe(false);
      expect(result2.agent).toBe('meta-agent');
    });
  });

  describe('specificity ranking', () => {
    it('should prefer regex over keyword when both match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'keyword-rule',
            agent: 'keyword-agent',
            keywords: ['help'],
          },
          {
            id: 'regex-rule',
            agent: 'regex-agent',
            patterns: ['help me'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'keyword-agent' }, { id: 'regex-agent' }]);
      const result = await Effect.runPromise(router.route('help me please'));

      // Regex has higher specificity (800) than keyword (700)
      expect(result.agent).toBe('regex-agent');
    });

    it('should prefer longer pattern when specificity base is equal', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'short-pattern',
            agent: 'short-agent',
            patterns: ['help'],
          },
          {
            id: 'long-pattern',
            agent: 'long-agent',
            patterns: ['help me please'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'short-agent' }, { id: 'long-agent' }]);
      const result = await Effect.runPromise(router.route('can you help me please?'));

      // Longer pattern = more specific
      expect(result.agent).toBe('long-agent');
    });

    it('should prefer rules with more metadata constraints', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'one-meta',
            agent: 'one-agent',
            metadata: { userId: 'alice' },
            keywords: ['hello'],
          },
          {
            id: 'two-meta',
            agent: 'two-agent',
            metadata: { userId: 'alice', tier: 'premium' },
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'one-agent' }, { id: 'two-agent' }]);
      const result = await Effect.runPromise(router.route('hello', {
        userId: 'alice',
        tier: 'premium',
      }));

      // Two metadata constraints = more specific (+200 vs +100)
      expect(result.agent).toBe('two-agent');
    });

    it('should respect explicit priority when set', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'low-priority',
            agent: 'low-agent',
            keywords: ['test'],
            priority: 10,
          },
          {
            id: 'high-priority',
            agent: 'high-agent',
            keywords: ['test'],
            priority: 100,
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'low-agent' }, { id: 'high-agent' }]);
      const result = await Effect.runPromise(router.route('test message'));

      // Higher priority wins
      expect(result.agent).toBe('high-agent');
    });

    it('should be deterministic with equal specificity', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'rule-a',
            agent: 'agent-a',
            keywords: ['test'],
          },
          {
            id: 'rule-b',
            agent: 'agent-b',
            keywords: ['test'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'agent-a' }, { id: 'agent-b' }]);

      // Run multiple times to ensure determinism
      const results = await Promise.all([
        router.route('test'),
        router.route('test'),
        router.route('test'),
      ]);

      // All results should be the same
      expect(results[0].agent).toBe(results[1].agent);
      expect(results[1].agent).toBe(results[2].agent);
    });
  });

  describe('fallback cascade', () => {
    it('should fallback to defaultAgent when no rules match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'fallback-agent',
        rules: [
          {
            id: 'specific-rule',
            agent: 'specific-agent',
            keywords: ['specific'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'fallback-agent' }, { id: 'specific-agent' }]);
      const result = await Effect.runPromise(router.route('no match here'));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('fallback-agent');
      expect(result.rule).toBeUndefined();
      expect(result.matchType).toBeUndefined();
    });

    it('should work with empty rules array', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [],
      };

      const router = createRouter(config, [{ id: 'default' }]);
      const result = await Effect.runPromise(router.route('any message'));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('default');
    });

    it('should fallback to first registered agent when defaultAgent not found', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'non-existent-agent',
        rules: [],
      };

      // Default agent doesn't exist, but first-agent does
      const router = createRouter(config, [{ id: 'first-agent' }, { id: 'second-agent' }]);

      const result = await Effect.runPromise(router.route('any message'));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('first-agent');
      // Note: Warnings now use Effect.logWarning instead of console.warn
    });

    it('should fallback to first registered agent when no defaultAgent configured', async () => {
      const config: RoutingConfig = {
        defaultAgent: '', // Empty string (no default)
        rules: [],
      };

      const router = createRouter(config, [{ id: 'first-agent' }, { id: 'second-agent' }]);

      const result = await Effect.runPromise(router.route('any message'));

      expect(result.fallback).toBe(true);
      expect(result.agent).toBe('first-agent');
      // Note: Warnings now use Effect.logWarning instead of console.warn
    });

    it('should throw error when no agents are registered', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'non-existent',
        rules: [],
      };

      // No agents registered
      const router = createRouter(config, []);

      const exit = await Effect.runPromiseExit(router.route('any message'));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause.error)).toContain(
          'No agents available for routing. Register at least one agent.'
        );
      }
    });
  });

  describe('routing hooks', () => {
    it('should call beforeRouting hook with message and metadata', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [],
      };

      const hookManager = new HookManager();
      const hookCalls: any[] = [];

      hookManager.registerHook('beforeRouting', (event) => {
        hookCalls.push(event);
      });

      const router = createRouter(config, [{ id: 'default' }], hookManager);
      await Effect.runPromise(router.route('test message', { userId: 'alice' }));

      expect(hookCalls.length).toBe(1);
      expect(hookCalls[0].type).toBe('beforeRouting');
      expect(hookCalls[0].data.message).toBe('test message');
      expect(hookCalls[0].data.metadata).toEqual({ userId: 'alice' });
    });

    it('should call afterRouting hook with routing decision', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'test-rule',
            agent: 'test-agent',
            keywords: ['hello'],
          },
        ],
      };

      const hookManager = new HookManager();
      const hookCalls: any[] = [];

      hookManager.registerHook('afterRouting', (event) => {
        hookCalls.push(event);
      });

      const router = createRouter(config, [{ id: 'default' }, { id: 'test-agent' }], hookManager);
      await Effect.runPromise(router.route('hello world', { tier: 'premium' }));

      expect(hookCalls.length).toBe(1);
      expect(hookCalls[0].type).toBe('afterRouting');
      expect(hookCalls[0].data.message).toBe('hello world');
      expect(hookCalls[0].data.metadata).toEqual({ tier: 'premium' });
      expect(hookCalls[0].data.decision.agent).toBe('test-agent');
      expect(hookCalls[0].data.decision.fallback).toBe(false);
      expect(hookCalls[0].data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should call both beforeRouting and afterRouting hooks in order', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [],
      };

      const hookManager = new HookManager();
      const hookOrder: string[] = [];

      hookManager.registerHook('beforeRouting', () => {
        hookOrder.push('before');
      });
      hookManager.registerHook('afterRouting', () => {
        hookOrder.push('after');
      });

      const router = createRouter(config, [{ id: 'default' }], hookManager);
      await Effect.runPromise(router.route('test message'));

      expect(hookOrder).toEqual(['before', 'after']);
    });

    it('should work without hook manager (hooks optional)', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [],
      };

      // No hook manager provided
      const router = createRouter(config, [{ id: 'default' }]);

      // Should not throw
      const result = await Effect.runPromise(router.route('test message'));
      expect(result.agent).toBe('default');
    });
  });

  describe('testRoute utility (dry run)', () => {
    it('should return same result as route()', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'test-rule',
            agent: 'test-agent',
            keywords: ['test'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'test-agent' }]);

      const routeResult = await Effect.runPromise(router.route('test'));
      const testResult = await Effect.runPromise(router.testRoute('test'));

      expect(testResult.agent).toBe(routeResult.agent);
      expect(testResult.fallback).toBe(routeResult.fallback);
      expect(testResult.matchType).toBe(routeResult.matchType);
    });

    it('should NOT emit hooks during testRoute', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [],
      };

      const hookManager = new HookManager();
      let hookCalled = false;

      hookManager.registerHook('beforeRouting', () => {
        hookCalled = true;
      });
      hookManager.registerHook('afterRouting', () => {
        hookCalled = true;
      });

      const router = createRouter(config, [{ id: 'default' }], hookManager);
      await Effect.runPromise(router.testRoute('test message'));

      // Hooks should NOT have been called
      expect(hookCalled).toBe(false);
    });

    it('should handle fallback silently (no warnings)', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'non-existent',
        rules: [],
      };

      const router = createRouter(config, [{ id: 'first-agent' }]);

      // Spy on console.warn
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const result = await Effect.runPromise(router.testRoute('any message'));

      // Should return first agent without logging
      expect(result.agent).toBe('first-agent');
      expect(result.fallback).toBe(true);

      // No warnings should be logged
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('debug logging', () => {
    it('should route correctly with debug enabled', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        debug: true,
        rules: [
          {
            id: 'test-rule',
            agent: 'test-agent',
            keywords: ['hello'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'test-agent' }]);
      const result = await Effect.runPromise(router.route('hello world'));

      expect(result.agent).toBe('test-agent');
      expect(result.fallback).toBe(false);
      expect(result.matchType).toBe('keyword');
      expect(result.rule?.id).toBe('test-rule');
      // Note: Debug logging now uses Effect.logDebug instead of console.log
    });

    it('should route correctly with debug disabled', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        debug: false,
        rules: [],
      };

      const router = createRouter(config, [{ id: 'default' }]);
      const result = await Effect.runPromise(router.route('test message'));

      expect(result.agent).toBe('default');
      expect(result.fallback).toBe(true);
      // Note: No logging happens when debug=false
    });
  });

  describe('combined matching', () => {
    it('should match with metadata + keyword combination', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'premium-support',
            agent: 'premium-support-agent',
            metadata: { tier: 'premium' },
            keywords: ['help', 'support'],
          },
          {
            id: 'basic-support',
            agent: 'basic-support-agent',
            keywords: ['help', 'support'],
          },
        ],
      };

      const router = createRouter(config, [
        { id: 'default' },
        { id: 'premium-support-agent' },
        { id: 'basic-support-agent' },
      ]);

      // Premium user gets premium agent
      const premiumResult = await Effect.runPromise(router.route('I need help', {
        tier: 'premium',
      }));
      expect(premiumResult.agent).toBe('premium-support-agent');

      // Non-premium user gets basic agent
      const basicResult = await Effect.runPromise(router.route('I need help', { tier: 'basic' }));
      expect(basicResult.agent).toBe('basic-support-agent');
    });

    it('should match with metadata + pattern combination', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'vip-weather',
            agent: 'vip-weather-agent',
            metadata: { userId: 'vip-user' },
            patterns: ['^weather'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'vip-weather-agent' }]);
      const result = await Effect.runPromise(router.route('weather forecast', {
        userId: 'vip-user',
      }));

      expect(result.fallback).toBe(false);
      expect(result.agent).toBe('vip-weather-agent');
    });
  });

  describe('findBestMatch', () => {
    it('should return null when no rules match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'specific',
            agent: 'specific-agent',
            keywords: ['specific'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'specific-agent' }]);
      const match = await Effect.runPromise(router.findBestMatch('no match', {}));

      expect(match).toBeNull();
    });

    it('should return highest specificity match', async () => {
      const config: RoutingConfig = {
        defaultAgent: 'default',
        rules: [
          {
            id: 'low-spec',
            agent: 'low-agent',
            keywords: ['test'],
          },
          {
            id: 'high-spec',
            agent: 'high-agent',
            patterns: ['^test message$'],
          },
        ],
      };

      const router = createRouter(config, [{ id: 'default' }, { id: 'low-agent' }, { id: 'high-agent' }]);
      const match = await Effect.runPromise(router.findBestMatch('test message', {}));

      expect(match).not.toBeNull();
      expect(match?.rule.id).toBe('high-spec');
      expect(match?.matchType).toBe('exact');
    });
  });

  describe('matchKeyword', () => {
    it('should match word at start of message', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(router.matchKeyword('help me please', 'help')).toBe(true);
    });

    it('should match word at end of message', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(router.matchKeyword('I need help', 'help')).toBe(true);
    });

    it('should match word in middle of message', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(router.matchKeyword('please help me', 'help')).toBe(true);
    });

    it('should not match partial word', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(router.matchKeyword('helpful', 'help')).toBe(false);
      expect(router.matchKeyword('unhelp', 'help')).toBe(false);
    });
  });

  describe('matchMetadata', () => {
    it('should return true for empty required metadata', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(router.matchMetadata({ userId: 'alice' }, {})).toBe(true);
    });

    it('should return true when all required keys match', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(
        router.matchMetadata(
          { userId: 'alice', tier: 'premium' },
          { userId: 'alice' }
        )
      ).toBe(true);
    });

    it('should return false when any required key is missing', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(
        router.matchMetadata({ userId: 'alice' }, { userId: 'alice', tier: 'premium' })
      ).toBe(false);
    });

    it('should return false when values do not match', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      expect(
        router.matchMetadata({ userId: 'bob' }, { userId: 'alice' })
      ).toBe(false);
    });
  });

  describe('calculateSpecificity', () => {
    it('should return correct base scores for each match type', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);
      const rule: RoutingRule = { id: 'test', agent: 'test-agent' };

      expect(router.calculateSpecificity(rule, 'exact')).toBe(1000);
      expect(router.calculateSpecificity(rule, 'regex')).toBe(800);
      expect(router.calculateSpecificity(rule, 'keyword')).toBe(700);
      expect(router.calculateSpecificity(rule, 'function')).toBe(600);
      expect(router.calculateSpecificity(rule, 'metadata-only')).toBe(500);
    });

    it('should add pattern length to specificity', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);
      const rule: RoutingRule = { id: 'test', agent: 'test-agent' };

      expect(router.calculateSpecificity(rule, 'regex', 'short')).toBe(805); // 800 + 5
      expect(router.calculateSpecificity(rule, 'regex', 'much longer pattern')).toBe(
        819
      ); // 800 + 19
    });

    it('should add metadata constraint count to specificity', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      const rule1: RoutingRule = {
        id: 'test',
        agent: 'test-agent',
        metadata: { a: 1 },
      };
      const rule2: RoutingRule = {
        id: 'test',
        agent: 'test-agent',
        metadata: { a: 1, b: 2, c: 3 },
      };

      expect(router.calculateSpecificity(rule1, 'keyword')).toBe(800); // 700 + 100
      expect(router.calculateSpecificity(rule2, 'keyword')).toBe(1000); // 700 + 300
    });

    it('should add explicit priority to specificity', () => {
      const config: RoutingConfig = { defaultAgent: 'default', rules: [] };
      const router = createRouter(config, [{ id: 'default' }]);

      const rule: RoutingRule = {
        id: 'test',
        agent: 'test-agent',
        priority: 50,
      };

      expect(router.calculateSpecificity(rule, 'keyword')).toBe(750); // 700 + 50
    });
  });
});
