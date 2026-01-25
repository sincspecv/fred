/**
 * WorkflowManager unit tests
 *
 * Tests workflow registration, retrieval, validation, and agent existence warnings.
 */

import { describe, it, expect, spyOn } from 'bun:test';
import { WorkflowManager } from '../../../../src/core/workflow/manager';
import { ToolRegistry } from '../../../../src/core/tool/registry';
import { AgentManager } from '../../../../src/core/agent/manager';
import { AgentInstance } from '../../../../src/core/agent/agent';

/**
 * Create a mock Fred-like object with agent manager
 */
function createMockFred(agents: { id: string }[] = []) {
  const toolRegistry = new ToolRegistry();
  const agentManager = new AgentManager(toolRegistry);

  // Manually add agents to the internal map for testing
  const agentsMap = (agentManager as any).agents as Map<string, AgentInstance>;
  for (const agent of agents) {
    agentsMap.set(agent.id, {
      id: agent.id,
      config: { id: agent.id, platform: 'test', model: 'test', systemMessage: 'test' },
      processMessage: async () => ({ content: 'test' }),
    } as AgentInstance);
  }

  // Create mock Fred object with getAgent method
  return {
    getAgent: (id: string) => agentManager.getAgent(id),
  };
}

describe('WorkflowManager', () => {
  describe('constructor', () => {
    it('should create WorkflowManager with Fred instance', () => {
      const fred = createMockFred() as any;
      const manager = new WorkflowManager(fred);

      expect(manager).toBeDefined();
      expect(manager.listWorkflows()).toEqual([]);
    });
  });

  describe('addWorkflow', () => {
    it('should store workflow correctly', () => {
      const fred = createMockFred([{ id: 'agent-1' }, { id: 'agent-2' }]) as any;
      const manager = new WorkflowManager(fred);

      manager.addWorkflow('test-workflow', {
        defaultAgent: 'agent-1',
        agents: ['agent-1', 'agent-2'],
      });

      const workflow = manager.getWorkflow('test-workflow');
      expect(workflow).toBeDefined();
      expect(workflow?.name).toBe('test-workflow');
      expect(workflow?.defaultAgent).toBe('agent-1');
      expect(workflow?.agents).toEqual(['agent-1', 'agent-2']);
    });

    it('should allow workflow with optional routing config', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      manager.addWorkflow('routed-workflow', {
        defaultAgent: 'agent-1',
        agents: ['agent-1'],
        routing: {
          defaultAgent: 'agent-1',
          rules: [],
        },
      });

      const workflow = manager.getWorkflow('routed-workflow');
      expect(workflow?.routing).toBeDefined();
      expect(workflow?.routing?.defaultAgent).toBe('agent-1');
    });
  });

  describe('getWorkflow', () => {
    it('should retrieve stored workflow', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1'],
      });

      const workflow = manager.getWorkflow('workflow-1');
      expect(workflow?.name).toBe('workflow-1');
    });

    it('should return undefined for non-existent workflow', () => {
      const fred = createMockFred() as any;
      const manager = new WorkflowManager(fred);

      const workflow = manager.getWorkflow('non-existent');
      expect(workflow).toBeUndefined();
    });
  });

  describe('listWorkflows', () => {
    it('should return all workflow names', () => {
      const fred = createMockFred([{ id: 'agent-1' }, { id: 'agent-2' }]) as any;
      const manager = new WorkflowManager(fred);

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1'],
      });
      manager.addWorkflow('workflow-2', {
        defaultAgent: 'agent-2',
        agents: ['agent-2'],
      });

      const names = manager.listWorkflows();
      expect(names).toContain('workflow-1');
      expect(names).toContain('workflow-2');
      expect(names.length).toBe(2);
    });

    it('should return empty array when no workflows registered', () => {
      const fred = createMockFred() as any;
      const manager = new WorkflowManager(fred);

      expect(manager.listWorkflows()).toEqual([]);
    });
  });

  describe('hasWorkflow', () => {
    it('should return true for existing workflow', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1'],
      });

      expect(manager.hasWorkflow('workflow-1')).toBe(true);
    });

    it('should return false for non-existent workflow', () => {
      const fred = createMockFred() as any;
      const manager = new WorkflowManager(fred);

      expect(manager.hasWorkflow('non-existent')).toBe(false);
    });
  });

  describe('validation warnings', () => {
    it('should warn when default agent not found', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'missing-agent',
        agents: ['agent-1'],
      });

      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0][0];
      expect(warnCall).toContain('[Workflow]');
      expect(warnCall).toContain('Default agent');
      expect(warnCall).toContain('missing-agent');
      expect(warnCall).toContain('workflow-1');

      warnSpy.mockRestore();
    });

    it('should warn when workflow agent not found', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1', 'missing-agent'],
      });

      expect(warnSpy).toHaveBeenCalled();
      const warnCall = warnSpy.mock.calls[0][0];
      expect(warnCall).toContain('[Workflow]');
      expect(warnCall).toContain('Agent');
      expect(warnCall).toContain('missing-agent');
      expect(warnCall).toContain('workflow-1');

      warnSpy.mockRestore();
    });

    it('should warn for multiple missing agents', () => {
      const fred = createMockFred([{ id: 'agent-1' }]) as any;
      const manager = new WorkflowManager(fred);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1', 'missing-1', 'missing-2'],
      });

      // Should have warnings for missing-1 and missing-2
      expect(warnSpy).toHaveBeenCalledTimes(2);

      warnSpy.mockRestore();
    });

    it('should NOT throw when agents are missing (non-blocking validation)', () => {
      const fred = createMockFred() as any;
      const manager = new WorkflowManager(fred);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw despite all agents missing
      expect(() => {
        manager.addWorkflow('workflow-1', {
          defaultAgent: 'missing-default',
          agents: ['missing-1', 'missing-2'],
        });
      }).not.toThrow();

      // Workflow should still be registered
      expect(manager.hasWorkflow('workflow-1')).toBe(true);

      warnSpy.mockRestore();
    });

    it('should NOT warn when all agents exist', () => {
      const fred = createMockFred([{ id: 'agent-1' }, { id: 'agent-2' }]) as any;
      const manager = new WorkflowManager(fred);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      manager.addWorkflow('workflow-1', {
        defaultAgent: 'agent-1',
        agents: ['agent-1', 'agent-2'],
      });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
