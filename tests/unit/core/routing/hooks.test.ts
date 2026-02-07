/**
 * Tests for conditional afterRoutingDecision hook emission
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MessageRouter } from '../../../../packages/core/src/routing/router';
import { AgentManager } from '../../../../packages/core/src/agent/manager';
import { HookManager } from '../../../../packages/core/src/hooks/manager';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import { Effect } from 'effect';
import type { HookEvent } from '../../../../packages/core/src/hooks/types';
import type { AdaptiveCalibrationCoordinator } from '../../../../packages/core/src/routing/calibration/adaptive';
import type { HistoricalAccuracyTracker } from '../../../../packages/core/src/routing/calibration/history';

describe('Conditional afterRoutingDecision Hook Emission', () => {
  let agentManager: AgentManager;
  let hookManager: HookManager;
  let router: MessageRouter;
  let hookEvents: HookEvent[];
  let mockCalibrator: AdaptiveCalibrationCoordinator;
  let mockHistoryTracker: HistoricalAccuracyTracker;

  beforeEach(() => {
    const toolRegistry = new ToolRegistry();
    agentManager = new AgentManager(toolRegistry);
    hookManager = new HookManager();
    hookEvents = [];

    // Register hook to capture events
    hookManager.registerHook('afterRoutingDecision', async (event) => {
      hookEvents.push(event);
    });

    // Mock calibrator that returns low confidence
    mockCalibrator = {
      calibrate: (score: number, source: 'rule' | 'intent') => Effect.succeed(score * 0.5), // Low confidence
    } as AdaptiveCalibrationCoordinator;

    // Mock history tracker
    mockHistoryTracker = {
      getAccuracy: (targetId: string) => Effect.succeed(0.7),
      getObservationCount: (targetId: string) => Effect.succeed(150),
    } as HistoricalAccuracyTracker;

    // Manually add agents to the internal map for testing
    const agentsMap = (agentManager as any).agents as Map<string, import('../../../../packages/core/src/agent/agent').AgentInstance>;
    agentsMap.set('agent-low-conf', {
      id: 'agent-low-conf',
      config: {
        id: 'agent-low-conf',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'test' }),
    });

    agentsMap.set('agent-high-conf', {
      id: 'agent-high-conf',
      config: {
        id: 'agent-high-conf',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'test' }),
    });
  });

  it('afterRoutingDecision hook emits when concerns exist (low confidence)', async () => {
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-low-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-low-conf',
            patterns: ['^test low confidence$'],
          },
        ],
      },
      mockCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test low confidence', {})
    );

    // Should have explanation with concerns
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBeGreaterThan(0);
    expect(decision.explanation!.concerns[0].type).toBe('low-confidence');

    // Hook should have been emitted
    expect(hookEvents.length).toBe(1);
    expect(hookEvents[0].type).toBe('afterRoutingDecision');
    expect(hookEvents[0].data.concerns).toBeDefined();
    expect(hookEvents[0].data.concerns.length).toBeGreaterThan(0);
  });

  it('afterRoutingDecision hook emits when concerns exist (close alternatives)', async () => {
    // Mock calibrator that returns close confidence values
    const closeCalibrator = {
      calibrate: (score: number, source: 'rule' | 'intent') => Effect.succeed(0.85), // High but close
    } as AdaptiveCalibrationCoordinator;

    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-low-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-low-conf',
            patterns: ['test'],
            priority: 100,
          },
          {
            id: 'rule-2',
            agent: 'agent-high-conf',
            patterns: ['test'],
            priority: 90, // Slightly lower priority
          },
        ],
      },
      closeCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test close alternatives', {})
    );

    // Should have explanation with close-alternatives concern
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBeGreaterThan(0);

    // Hook should have been emitted
    expect(hookEvents.length).toBe(1);
    expect(hookEvents[0].type).toBe('afterRoutingDecision');
  });

  it('afterRoutingDecision hook does NOT emit when confidence is high', async () => {
    // Mock calibrator that returns high confidence
    const highConfCalibrator = {
      calibrate: (score: number, source: 'rule' | 'intent') => Effect.succeed(0.95), // Very high
    } as AdaptiveCalibrationCoordinator;

    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-high-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-high-conf',
            patterns: ['^test high confidence$'],
          },
        ],
      },
      highConfCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test high confidence', {})
    );

    // Should have explanation with NO concerns
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBe(0);

    // Hook should NOT have been emitted
    expect(hookEvents.length).toBe(0);
  });

  it('afterRoutingDecision hook failure does not crash routing', async () => {
    // Register hook that throws
    hookManager.registerHook('afterRoutingDecision', async () => {
      throw new Error('Hook failed');
    });

    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-low-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-low-conf',
            patterns: ['^test$'],
          },
        ],
      },
      mockCalibrator,
      mockHistoryTracker
    );

    // Should not throw despite hook failure
    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    expect(decision).toBeDefined();
    expect(decision.agent).toBe('agent-low-conf');
  });

  it('clarificationNeeded PauseSignal generated when confidence < 0.6', async () => {
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-low-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-low-conf',
            patterns: ['^test$'],
          },
        ],
      },
      mockCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    // Should have clarificationNeeded signal
    expect(decision.clarificationNeeded).toBeDefined();
    expect(decision.clarificationNeeded!.__pause).toBe(true);
    expect(decision.clarificationNeeded!.prompt).toContain('Low confidence');
    expect(decision.clarificationNeeded!.resumeBehavior).toBe('continue');
  });

  it('clarificationNeeded PauseSignal generated when top-2 gap < 0.1', async () => {
    // Mock calibrator that returns close confidence values
    const closeCalibrator = {
      calibrate: (score: number, source: 'rule' | 'intent') => Effect.succeed(0.85), // High but close
    } as AdaptiveCalibrationCoordinator;

    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-low-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-low-conf',
            patterns: ['test'],
            priority: 100,
          },
          {
            id: 'rule-2',
            agent: 'agent-high-conf',
            patterns: ['test'],
            priority: 90,
          },
        ],
      },
      closeCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    // Should have clarificationNeeded signal
    expect(decision.clarificationNeeded).toBeDefined();
    expect(decision.clarificationNeeded!.__pause).toBe(true);
    expect(decision.clarificationNeeded!.prompt).toContain('Close alternatives');
  });

  it('no clarificationNeeded when confidence is high', async () => {
    // Mock calibrator that returns high confidence
    const highConfCalibrator = {
      calibrate: (score: number, source: 'rule' | 'intent') => Effect.succeed(0.95),
    } as AdaptiveCalibrationCoordinator;

    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-high-conf',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-high-conf',
            patterns: ['^test$'],
          },
        ],
      },
      highConfCalibrator,
      mockHistoryTracker
    );

    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    // Should NOT have clarificationNeeded signal
    expect(decision.clarificationNeeded).toBeUndefined();
  });
});
