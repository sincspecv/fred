/**
 * PipelineManager Graph Workflow Integration Tests
 *
 * Tests for graph workflow lifecycle management in PipelineManager.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PipelineManager } from '../../../../src/core/pipeline/manager';
import { AgentManager } from '../../../../src/core/agent/manager';
import type { GraphWorkflowConfig } from '../../../../src/core/pipeline/graph';
import type { AgentResponse } from '../../../../src/core/agent/agent';

// Mock agent manager
function createMockAgentManager(): AgentManager {
  const agents = new Map<string, any>();

  agents.set('agent1', {
    processMessage: async (input: string) => ({
      content: `agent1 processed: ${input}`,
      toolCalls: [],
    }),
  });

  agents.set('agent2', {
    processMessage: async (input: string) => ({
      content: `agent2 processed: ${input}`,
      toolCalls: [],
    }),
  });

  agents.set('sales', {
    processMessage: async (input: string) => ({
      type: 'handoff_request',
      targetAgent: 'support',
      reason: 'Technical question',
    }),
  });

  agents.set('support', {
    processMessage: async (input: string) => ({
      content: `support handled: ${input}`,
      toolCalls: [],
    }),
  });

  return {
    getAgent: (id: string) => agents.get(id),
    hasAgent: (id: string) => agents.has(id),
  } as any;
}

describe('PipelineManager Graph Workflows', () => {
  let manager: PipelineManager;
  let agentManager: AgentManager;

  beforeEach(() => {
    agentManager = createMockAgentManager();
    manager = new PipelineManager(agentManager);
  });

  describe('registerGraphWorkflow', () => {
    test('registers valid graph workflow', () => {
      const config: GraphWorkflowConfig = {
        id: 'test-graph',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'node1', agentId: 'agent1' },
        ],
        edges: [],
        entryNode: 'node1',
      };

      manager.registerGraphWorkflow(config);

      expect(manager.hasGraphWorkflow('test-graph')).toBe(true);
      expect(manager.getGraphWorkflow('test-graph')).toEqual(config);
    });

    test('throws on duplicate workflow ID', () => {
      const config: GraphWorkflowConfig = {
        id: 'duplicate',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'node1', agentId: 'agent1' },
        ],
        edges: [],
        entryNode: 'node1',
      };

      manager.registerGraphWorkflow(config);

      expect(() => manager.registerGraphWorkflow(config)).toThrow('already exists');
    });

    test('validates graph workflow config', () => {
      const invalidConfig: GraphWorkflowConfig = {
        id: 'invalid',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'node1', agentId: 'agent1' },
        ],
        edges: [],
        entryNode: 'nonexistent', // Entry node doesn't exist
      };

      expect(() => manager.registerGraphWorkflow(invalidConfig)).toThrow('entry node');
    });
  });

  describe('executeGraphWorkflow', () => {
    test('executes registered graph workflow', async () => {
      const config: GraphWorkflowConfig = {
        id: 'simple-graph',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'node1', agentId: 'agent1' },
        ],
        edges: [],
        entryNode: 'node1',
      };

      manager.registerGraphWorkflow(config);

      const result = await manager.executeGraphWorkflow('simple-graph', 'test input');

      expect(result.success).toBe(true);
      expect(result.outputs['node1']).toEqual({
        content: 'agent1 processed: test input',
        toolCalls: [],
      });
    });

    test('throws if workflow not found', async () => {
      await expect(
        manager.executeGraphWorkflow('nonexistent', 'input')
      ).rejects.toThrow('Graph workflow not found');
    });
  });

  describe('Graph workflow with handoff', () => {
    test('handoff within graph workflow transfers context correctly', async () => {
      const config: GraphWorkflowConfig = {
        id: 'handoff-graph',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'sales-node', agentId: 'sales' },
        ],
        edges: [],
        entryNode: 'sales-node',
        handoffs: {
          sales: ['support'],
        },
      };

      manager.registerGraphWorkflow(config);

      const result = await manager.executeGraphWorkflow('handoff-graph', 'help me');

      expect(result.success).toBe(true);
      expect(result.outputs['sales-node']).toEqual({
        content: 'support handled: help me',
        toolCalls: [],
      });
      expect(result.context.metadata.handoffFrom).toBe('sales');
      expect(result.context.metadata.handoffTo).toBe('support');
    });

    test('handoff chain works through manager', async () => {
      // Add chaining agent
      const mockAgentManagerWithChain = createMockAgentManager();
      (mockAgentManagerWithChain as any).getAgent = (id: string) => {
        if (id === 'triage') {
          return {
            processMessage: async () => ({
              type: 'handoff_request',
              targetAgent: 'specialist',
              reason: 'Needs specialist',
            }),
          };
        }
        if (id === 'specialist') {
          return {
            processMessage: async () => ({
              type: 'handoff_request',
              targetAgent: 'expert',
              reason: 'Needs expert',
            }),
          };
        }
        if (id === 'expert') {
          return {
            processMessage: async (input: string) => ({
              content: `expert resolved: ${input}`,
              toolCalls: [],
            }),
          };
        }
        return undefined;
      };
      (mockAgentManagerWithChain as any).hasAgent = () => true;

      const chainManager = new PipelineManager(mockAgentManagerWithChain);

      const config: GraphWorkflowConfig = {
        id: 'chain-graph',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'triage-node', agentId: 'triage' },
        ],
        edges: [],
        entryNode: 'triage-node',
        handoffs: {
          triage: ['specialist'],
          specialist: ['expert'],
          expert: [],
        },
      };

      chainManager.registerGraphWorkflow(config);

      const result = await chainManager.executeGraphWorkflow('chain-graph', 'complex issue');

      expect(result.success).toBe(true);
      expect(result.outputs['triage-node']).toEqual({
        content: 'expert resolved: complex issue',
        toolCalls: [],
      });
      const chain = result.context.metadata.handoffChain as string[];
      expect(chain).toContain('triage');
      expect(chain).toContain('specialist');
    });

    test('invalid handoff target returns error to source', async () => {
      const config: GraphWorkflowConfig = {
        id: 'invalid-handoff-graph',
        type: 'graph',
        nodes: [
          { type: 'agent', id: 'sales-node', agentId: 'sales' },
        ],
        edges: [],
        entryNode: 'sales-node',
        handoffs: {
          sales: ['agent1'], // support not in allowed list
        },
      };

      manager.registerGraphWorkflow(config);

      const result = await manager.executeGraphWorkflow('invalid-handoff-graph', 'help');

      expect(result.success).toBe(true);
      expect(result.outputs['sales-node']).toMatchObject({
        type: 'handoff_error',
        error: expect.stringContaining('not allowed'),
        availableTargets: ['agent1'],
      });
    });
  });

  describe('getAllGraphWorkflows', () => {
    test('returns all registered graph workflows', () => {
      const config1: GraphWorkflowConfig = {
        id: 'graph1',
        type: 'graph',
        nodes: [{ type: 'agent', id: 'n1', agentId: 'agent1' }],
        edges: [],
        entryNode: 'n1',
      };

      const config2: GraphWorkflowConfig = {
        id: 'graph2',
        type: 'graph',
        nodes: [{ type: 'agent', id: 'n2', agentId: 'agent2' }],
        edges: [],
        entryNode: 'n2',
      };

      manager.registerGraphWorkflow(config1);
      manager.registerGraphWorkflow(config2);

      const all = manager.getAllGraphWorkflows();
      expect(all).toHaveLength(2);
      expect(all.map(g => g.id)).toContain('graph1');
      expect(all.map(g => g.id)).toContain('graph2');
    });
  });

  describe('clear', () => {
    test('clears graph workflows', () => {
      const config: GraphWorkflowConfig = {
        id: 'test',
        type: 'graph',
        nodes: [{ type: 'agent', id: 'n1', agentId: 'agent1' }],
        edges: [],
        entryNode: 'n1',
      };

      manager.registerGraphWorkflow(config);
      expect(manager.hasGraphWorkflow('test')).toBe(true);

      manager.clear();
      expect(manager.hasGraphWorkflow('test')).toBe(false);
    });
  });
});
