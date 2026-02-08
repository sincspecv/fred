/**
 * Integration tests for routing explain() API and AgentResponse extension
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Fred } from '../../../../packages/core/src/index';
import { MessageRouter } from '../../../../packages/core/src/routing/router';
import { AgentManager } from '../../../../packages/core/src/agent/manager';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import type { AgentInstance } from '../../../../packages/core/src/agent/agent';

describe('Routing Explain API Integration', () => {
  let fred: Fred;
  let agentManager: AgentManager;

  beforeEach(() => {
    fred = new Fred();
    agentManager = fred.getAgentManager();

    // Manually add test agents
    const agentsMap = (agentManager as any).agents as Map<string, AgentInstance>;
    agentsMap.set('help-agent', {
      id: 'help-agent',
      config: {
        id: 'help-agent',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'Help response' }),
    });

    agentsMap.set('math-agent', {
      id: 'math-agent',
      config: {
        id: 'math-agent',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'Math response' }),
    });

    // Configure routing
    (fred as any).messageRouter = new MessageRouter(
      agentManager,
      undefined, // No hook manager for these tests
      {
        defaultAgent: 'help-agent',
        rules: [
          {
            id: 'help-rule',
            agent: 'help-agent',
            patterns: ['^help'],
          },
          {
            id: 'math-rule',
            agent: 'math-agent',
            patterns: ['math|calculate|compute'],
          },
        ],
      }
    );

    // Update message processor deps
    (fred as any).messageProcessor.updateDeps({
      messageRouter: (fred as any).messageRouter,
    });
  });

  it('fred.routing.explain() returns RoutingExplanation for rule-matched message', async () => {
    const explanation = await fred.routing.explain('help me with something');

    expect(explanation).toBeDefined();
    expect(explanation!.winner).toBeDefined();
    expect(explanation!.winner.targetId).toBe('help-agent');
    expect(explanation!.confidence).toBeGreaterThan(0);
    expect(explanation!.matchType).toBe('regex');
    expect(explanation!.narrative).toContain('help-agent');
  });

  it('fred.routing.explain() returns explanation with alternatives', async () => {
    // Message that could match multiple rules
    const explanation = await fred.routing.explain('help with math');

    expect(explanation).toBeDefined();
    expect(explanation!.winner).toBeDefined();
    // Could match either rule - just verify we get alternatives
    expect(explanation!.alternatives).toBeDefined();
    expect(Array.isArray(explanation!.alternatives)).toBe(true);
  });

  it('fred.routing.explain() returns null when no router configured', async () => {
    const fredNoRouter = new Fred();
    const explanation = await fredNoRouter.routing.explain('test message');

    expect(explanation).toBeNull();
  });

  it('AgentResponse includes routingExplanation', async () => {
    const response = await fred.processMessage('help me');

    expect(response).toBeDefined();
    expect(response!.content).toBe('Help response');
    expect(response!.routingExplanation).toBeDefined();
    expect(response!.routingExplanation!.winner.targetId).toBe('help-agent');
  });

  it('explanation narrative contains routing details', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.narrative).toBeDefined();
    expect(typeof explanation!.narrative).toBe('string');
    expect(explanation!.narrative.length).toBeGreaterThan(0);
    // Should contain key details
    expect(explanation!.narrative).toContain('help-agent');
  });

  it('explanation confidence is numeric (no qualitative labels)', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(typeof explanation!.confidence).toBe('number');
    expect(explanation!.confidence).toBeGreaterThanOrEqual(0);
    expect(explanation!.confidence).toBeLessThanOrEqual(1);
    // Verify no string labels like "HIGH" or "MEDIUM"
    expect(explanation!.narrative).not.toMatch(/\b(HIGH|MEDIUM|LOW)\b/);
  });

  it('explanation alternatives sorted by confidence descending', async () => {
    // Configure multiple rules to get alternatives
    (fred as any).messageRouter = new MessageRouter(
      agentManager,
      undefined,
      {
        defaultAgent: 'help-agent',
        rules: [
          {
            id: 'rule-1',
            agent: 'help-agent',
            patterns: ['help'],
            priority: 100,
          },
          {
            id: 'rule-2',
            agent: 'math-agent',
            patterns: ['help'], // Same pattern, lower priority
            priority: 50,
          },
        ],
      }
    );

    (fred as any).messageProcessor.updateDeps({
      messageRouter: (fred as any).messageRouter,
    });

    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.alternatives.length).toBeGreaterThan(0);

    // Verify sorted by confidence descending
    for (let i = 1; i < explanation!.alternatives.length; i++) {
      expect(explanation!.alternatives[i - 1].confidence).toBeGreaterThanOrEqual(
        explanation!.alternatives[i].confidence
      );
    }
  });

  it('explanation includes calibration metadata', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.calibrationMetadata).toBeDefined();
    expect(explanation!.calibrationMetadata.rawScore).toBeDefined();
    expect(explanation!.calibrationMetadata.calibratedScore).toBeDefined();
    expect(typeof explanation!.calibrationMetadata.calibrated).toBe('boolean');
  });

  it('explanation concerns array is defined (may be empty)', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.concerns).toBeDefined();
    expect(Array.isArray(explanation!.concerns)).toBe(true);
  });
});
