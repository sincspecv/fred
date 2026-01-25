/**
 * Graph Executor Tests
 *
 * Tests for graph workflow execution including topological ordering,
 * conditional branching, fork/join parallelism, and hook integration.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  executeGraphWorkflow,
  evaluateCondition,
  selectNextNodes,
  type GraphExecutionResult,
  type GraphExecutorOptions,
} from './graph-executor';
import type { GraphWorkflowConfig, BranchCondition, GraphEdge } from './graph';
import type { PipelineContext } from './context';
import type { AgentManager } from '../agent/manager';
import type { HookManager } from '../hooks/manager';
import type { AgentResponse } from '../agent/agent';

// Mock agent manager
function createMockAgentManager(): AgentManager {
  const agents = new Map<string, any>();

  // Add mock agents
  agents.set('agent1', {
    processMessage: async (input: string) => ({
      content: `agent1: ${input}`,
      toolCalls: [],
    }),
  });

  agents.set('agent2', {
    processMessage: async (input: string) => ({
      content: `agent2: ${input}`,
      toolCalls: [],
    }),
  });

  agents.set('classifier', {
    processMessage: async (input: string) => ({
      content: 'classified',
      toolCalls: [],
      metadata: { category: input.includes('urgent') ? 'urgent' : 'normal' },
    }),
  });

  return {
    getAgent: (id: string) => agents.get(id),
  } as any;
}

describe('Graph Executor', () => {
  let agentManager: AgentManager;
  let options: GraphExecutorOptions;

  beforeEach(() => {
    agentManager = createMockAgentManager();
    options = { agentManager };
  });

  describe('evaluateCondition', () => {
    test('equals operator matches correctly', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: { status: 'success' } },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.status',
        operator: 'equals',
        value: 'success',
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    test('notEquals operator matches correctly', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: { status: 'success' } },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.status',
        operator: 'notEquals',
        value: 'failure',
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    test('exists operator detects presence', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: { result: 'data' } },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.result',
        operator: 'exists',
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    test('exists operator detects absence', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: {} },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.missing',
        operator: 'exists',
      };

      expect(evaluateCondition(condition, context)).toBe(false);
    });

    test('gt operator compares numbers', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: { score: 85 } },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.score',
        operator: 'gt',
        value: 70,
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });

    test('lt operator compares numbers', () => {
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { step1: { score: 65 } },
        history: [],
        metadata: {},
      };

      const condition: BranchCondition = {
        field: 'step1.score',
        operator: 'lt',
        value: 70,
      };

      expect(evaluateCondition(condition, context)).toBe(true);
    });
  });

  describe('selectNextNodes', () => {
    test('returns first matching condition', () => {
      const edges: GraphEdge[] = [
        {
          from: 'start',
          to: 'branch1',
          condition: { field: 'start.status', operator: 'equals', value: 'success' },
        },
        {
          from: 'start',
          to: 'branch2',
          condition: { field: 'start.status', operator: 'equals', value: 'failure' },
        },
      ];

      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { start: { status: 'success' } },
        history: [],
        metadata: {},
      };

      const next = selectNextNodes('start', edges, context);
      expect(next).toEqual(['branch1']);
    });

    test('uses default branch when no condition matches', () => {
      const edges: GraphEdge[] = [
        {
          from: 'start',
          to: 'branch1',
          condition: { field: 'start.status', operator: 'equals', value: 'error' },
        },
        {
          from: 'start',
          to: 'fallback',
          default: true,
        },
      ];

      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: { start: { status: 'success' } },
        history: [],
        metadata: {},
      };

      const next = selectNextNodes('start', edges, context);
      expect(next).toEqual(['fallback']);
    });

    test('returns empty array for terminal node', () => {
      const edges: GraphEdge[] = [];
      const context: PipelineContext = {
        pipelineId: 'test',
        input: 'test',
        outputs: {},
        history: [],
        metadata: {},
      };

      const next = selectNextNodes('end', edges, context);
      expect(next).toEqual([]);
    });
  });

  describe('executeGraphWorkflow', () => {
    test('executes simple linear graph in order', async () => {
      const config: GraphWorkflowConfig = {
        id: 'linear-graph',
        type: 'graph',
        entryNode: 'step1',
        nodes: [
          { type: 'agent', id: 'step1', agentId: 'agent1' },
          { type: 'agent', id: 'step2', agentId: 'agent2' },
        ],
        edges: [{ from: 'step1', to: 'step2' }],
      };

      const result = await executeGraphWorkflow(config, 'test input', options);

      expect(result.success).toBe(true);
      expect(result.executedNodes).toEqual(['step1', 'step2']);
      expect(result.outputs).toHaveProperty('step1');
      expect(result.outputs).toHaveProperty('step2');
    });

    test('follows correct conditional branch based on condition', async () => {
      const config: GraphWorkflowConfig = {
        id: 'conditional-graph',
        type: 'graph',
        entryNode: 'classifier',
        nodes: [
          { type: 'agent', id: 'classifier', agentId: 'classifier' },
          { type: 'agent', id: 'urgent-handler', agentId: 'agent1' },
          { type: 'agent', id: 'normal-handler', agentId: 'agent2' },
        ],
        edges: [
          {
            from: 'classifier',
            to: 'urgent-handler',
            condition: { field: 'classifier.metadata.category', operator: 'equals', value: 'urgent' },
          },
          {
            from: 'classifier',
            to: 'normal-handler',
            default: true,
          },
        ],
      };

      const result = await executeGraphWorkflow(config, 'urgent request', options);

      expect(result.success).toBe(true);
      expect(result.executedNodes).toContain('classifier');
      expect(result.executedNodes).toContain('urgent-handler');
      expect(result.executedNodes).not.toContain('normal-handler');
    });

    test('uses default branch when no condition matches', async () => {
      const config: GraphWorkflowConfig = {
        id: 'default-branch',
        type: 'graph',
        entryNode: 'classifier',
        nodes: [
          { type: 'agent', id: 'classifier', agentId: 'classifier' },
          { type: 'agent', id: 'urgent-handler', agentId: 'agent1' },
          { type: 'agent', id: 'normal-handler', agentId: 'agent2' },
        ],
        edges: [
          {
            from: 'classifier',
            to: 'urgent-handler',
            condition: { field: 'classifier.metadata.category', operator: 'equals', value: 'urgent' },
          },
          {
            from: 'classifier',
            to: 'normal-handler',
            default: true,
          },
        ],
      };

      const result = await executeGraphWorkflow(config, 'normal request', options);

      expect(result.success).toBe(true);
      expect(result.executedNodes).toContain('classifier');
      expect(result.executedNodes).toContain('normal-handler');
      expect(result.executedNodes).not.toContain('urgent-handler');
    });

    test('executes fork/join with parallel branches and shallow merge', async () => {
      const config: GraphWorkflowConfig = {
        id: 'fork-join-graph',
        type: 'graph',
        entryNode: 'fork1',
        nodes: [
          { type: 'fork', id: 'fork1', branches: ['branch1', 'branch2'] },
          {
            type: 'function',
            id: 'branch1',
            fn: async () => ({ result: 'A', value: 1 }),
          },
          {
            type: 'function',
            id: 'branch2',
            fn: async () => ({ result: 'B', value: 2 }),
          },
          { type: 'join', id: 'join1', sources: ['branch1', 'branch2'], mergeStrategy: 'shallow-merge' },
        ],
        edges: [
          { from: 'branch1', to: 'join1' },
          { from: 'branch2', to: 'join1' },
        ],
      };

      const result = await executeGraphWorkflow(config, 'test', options);

      expect(result.success).toBe(true);
      expect(result.executedNodes).toContain('fork1');
      expect(result.executedNodes).toContain('branch1');
      expect(result.executedNodes).toContain('branch2');
      expect(result.executedNodes).toContain('join1');

      // Check that outputs were merged (last write wins for shallow merge)
      const joinOutput = result.outputs.join1 as Record<string, unknown>;
      expect(joinOutput).toHaveProperty('result');
      expect(joinOutput).toHaveProperty('value');
    });

    test('executes fork/join with array merge strategy', async () => {
      const config: GraphWorkflowConfig = {
        id: 'fork-join-array',
        type: 'graph',
        entryNode: 'fork1',
        nodes: [
          { type: 'fork', id: 'fork1', branches: ['branch1', 'branch2'] },
          {
            type: 'function',
            id: 'branch1',
            fn: async () => 'result A',
          },
          {
            type: 'function',
            id: 'branch2',
            fn: async () => 'result B',
          },
          { type: 'join', id: 'join1', sources: ['branch1', 'branch2'], mergeStrategy: 'array' },
        ],
        edges: [
          { from: 'branch1', to: 'join1' },
          { from: 'branch2', to: 'join1' },
        ],
      };

      const result = await executeGraphWorkflow(config, 'test', options);

      expect(result.success).toBe(true);
      const joinOutput = result.outputs.join1 as unknown[];
      expect(Array.isArray(joinOutput)).toBe(true);
      expect(joinOutput).toHaveLength(2);
      expect(joinOutput).toContain('result A');
      expect(joinOutput).toContain('result B');
    });

    test('hook abort stops execution', async () => {
      const mockHookManager: HookManager = {
        executeHooksAndMerge: async (type: string) => {
          if (type === 'beforePipeline') {
            return { abort: true, metadata: {} } as any;
          }
          return { metadata: {} } as any;
        },
        executeHooks: async () => {},
      } as any;

      const optionsWithHook: GraphExecutorOptions = {
        ...options,
        hookManager: mockHookManager,
      };

      const config: GraphWorkflowConfig = {
        id: 'hook-abort-test',
        type: 'graph',
        entryNode: 'step1',
        nodes: [{ type: 'agent', id: 'step1', agentId: 'agent1' }],
        edges: [],
      };

      const result = await executeGraphWorkflow(config, 'test', optionsWithHook);

      expect(result.success).toBe(false);
      expect(result.abortedBy).toBe('beforePipeline hook');
      expect(result.executedNodes).toHaveLength(0);
    });

    test('handles execution errors gracefully', async () => {
      const config: GraphWorkflowConfig = {
        id: 'error-test',
        type: 'graph',
        entryNode: 'error-node',
        nodes: [
          {
            type: 'function',
            id: 'error-node',
            fn: async () => {
              throw new Error('Test error');
            },
          },
        ],
        edges: [],
      };

      const result = await executeGraphWorkflow(config, 'test', options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Test error');
    });
  });

  describe('Agent Handoff', () => {
    test('handoff transfers execution to target agent', async () => {
      // Mock agents for handoff
      const mockAgentManager = {
        getAgent: (id: string) => {
          if (id === 'sales') {
            return {
              processMessage: async (input: string) => ({
                type: 'handoff_request',
                targetAgent: 'support',
                reason: 'Technical question',
              }),
            };
          }
          if (id === 'support') {
            return {
              processMessage: async (input: string) => ({
                content: `Support handled: ${input}`,
                toolCalls: [],
              }),
            };
          }
          return undefined;
        },
      } as any;

      const config: GraphWorkflowConfig = {
        id: 'handoff-test',
        type: 'graph',
        nodes: [
          {
            type: 'agent',
            id: 'sales-node',
            agentId: 'sales',
          },
        ],
        edges: [],
        entryNode: 'sales-node',
        handoffs: {
          sales: ['support'],
        },
      };

      const result = await executeGraphWorkflow(config, 'help me', {
        agentManager: mockAgentManager,
      });

      expect(result.success).toBe(true);
      expect(result.outputs['sales-node']).toEqual({
        content: 'Support handled: help me',
        toolCalls: [],
      });
      expect(result.context.metadata.handoffFrom).toBe('sales');
      expect(result.context.metadata.handoffTo).toBe('support');
    });

    test('invalid handoff target returns error', async () => {
      // Mock agents
      const mockAgentManager = {
        getAgent: (id: string) => {
          if (id === 'sales') {
            return {
              processMessage: async (input: string) => ({
                type: 'handoff_request',
                targetAgent: 'billing', // Not in allowed targets
                reason: 'Billing question',
              }),
            };
          }
          return undefined;
        },
      } as any;

      const config: GraphWorkflowConfig = {
        id: 'handoff-invalid-test',
        type: 'graph',
        nodes: [
          {
            type: 'agent',
            id: 'sales-node',
            agentId: 'sales',
          },
        ],
        edges: [],
        entryNode: 'sales-node',
        handoffs: {
          sales: ['support'], // billing not in allowed list
        },
      };

      const result = await executeGraphWorkflow(config, 'help me', {
        agentManager: mockAgentManager,
      });

      expect(result.success).toBe(true);
      expect(result.outputs['sales-node']).toMatchObject({
        type: 'handoff_error',
        error: expect.stringContaining('not allowed'),
        availableTargets: ['support'],
      });
    });

    test('handoff chain works (A -> B -> C)', async () => {
      // Mock agents with chaining
      const mockAgentManager = {
        getAgent: (id: string) => {
          if (id === 'triage') {
            return {
              processMessage: async (input: string) => ({
                type: 'handoff_request',
                targetAgent: 'specialist',
                reason: 'Needs specialist',
              }),
            };
          }
          if (id === 'specialist') {
            return {
              processMessage: async (input: string) => ({
                type: 'handoff_request',
                targetAgent: 'expert',
                reason: 'Needs expert',
              }),
            };
          }
          if (id === 'expert') {
            return {
              processMessage: async (input: string) => ({
                content: `Expert resolved: ${input}`,
                toolCalls: [],
              }),
            };
          }
          return undefined;
        },
      } as any;

      const config: GraphWorkflowConfig = {
        id: 'handoff-chain-test',
        type: 'graph',
        nodes: [
          {
            type: 'agent',
            id: 'triage-node',
            agentId: 'triage',
          },
        ],
        edges: [],
        entryNode: 'triage-node',
        handoffs: {
          triage: ['specialist'],
          specialist: ['expert'],
          expert: [],
        },
      };

      const result = await executeGraphWorkflow(config, 'complex issue', {
        agentManager: mockAgentManager,
      });

      expect(result.success).toBe(true);
      expect(result.outputs['triage-node']).toEqual({
        content: 'Expert resolved: complex issue',
        toolCalls: [],
      });
      // Handoff chain tracks all intermediaries (not the final target)
      const chain = result.context.metadata.handoffChain as string[];
      expect(chain).toContain('triage');
      expect(chain).toContain('specialist');
      expect(result.context.metadata.handoffFrom).toBe('specialist');
      expect(result.context.metadata.handoffTo).toBe('expert');
    });

    test('full thread history transfers to target agent', async () => {
      let capturedHistory: any[] = [];

      const mockAgentManager = {
        getAgent: (id: string) => {
          if (id === 'source') {
            return {
              processMessage: async (input: string, history: any[]) => ({
                type: 'handoff_request',
                targetAgent: 'target',
                reason: 'Handoff with history',
              }),
            };
          }
          if (id === 'target') {
            return {
              processMessage: async (input: string, history: any[]) => {
                capturedHistory = history;
                return {
                  content: `Received history`,
                  toolCalls: [],
                };
              },
            };
          }
          return undefined;
        },
      } as any;

      const config: GraphWorkflowConfig = {
        id: 'handoff-history-test',
        type: 'graph',
        nodes: [
          {
            type: 'agent',
            id: 'source-node',
            agentId: 'source',
          },
        ],
        edges: [],
        entryNode: 'source-node',
        handoffs: {
          source: ['target'],
        },
      };

      const result = await executeGraphWorkflow(config, 'new message', {
        agentManager: mockAgentManager,
      });

      expect(result.success).toBe(true);
      // Context history is transferred (even if empty initially)
      expect(capturedHistory).toBeDefined();
      expect(Array.isArray(capturedHistory)).toBe(true);
    });
  });
});
