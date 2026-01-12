import { describe, test, expect, beforeEach } from 'bun:test';
import { PipelineManager } from '../../../../src/core/pipeline/manager';
import { AgentManager } from '../../../../src/core/agent/manager';
import { ToolRegistry } from '../../../../src/core/tool/registry';
import { PipelineConfig } from '../../../../src/core/pipeline/pipeline';
import { createMockAgent } from '../../helpers/mock-agent';
import { createMockProvider } from '../../helpers/mock-provider';

describe('PipelineManager', () => {
  let manager: PipelineManager;
  let agentManager: AgentManager;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    agentManager = new AgentManager(toolRegistry);
    manager = new PipelineManager(agentManager);
  });

  describe('createPipeline', () => {
    test('should create pipeline with string agent references', async () => {
      // Create agents first
      const agent1 = createMockAgent('agent-1');
      const agent2 = createMockAgent('agent-2');
      agentManager['agents'].set('agent-1', agent1);
      agentManager['agents'].set('agent-2', agent2);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1', 'agent-2'],
      };

      const pipeline = await manager.createPipeline(config);

      expect(pipeline).toBeDefined();
      expect(pipeline.id).toBe('test-pipeline');
      expect(manager.hasPipeline('test-pipeline')).toBe(true);
    });

    test('should throw error for duplicate pipeline ID', async () => {
      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      // Create first pipeline
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);
      await manager.createPipeline(config);

      // Try to create duplicate
      await expect(manager.createPipeline(config)).rejects.toThrow(
        'Pipeline with id "test-pipeline" already exists'
      );
    });

    test('should throw error when agent reference does not exist', async () => {
      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['nonexistent-agent'],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        'Pipeline "test-pipeline" references agent "nonexistent-agent" which does not exist'
      );
    });

    test('should throw error for invalid pipeline ID format', async () => {
      const config: PipelineConfig = {
        id: 'invalid id with spaces',
        agents: ['agent-1'],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow();
    });

    test('should throw error for empty agents array', async () => {
      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: [],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        'Pipeline must have at least one agent'
      );
    });

    test('should handle inline agent configs', async () => {
      const provider = createMockProvider();
      agentManager.registerProvider('openai', provider);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: [
          {
            id: 'inline-agent',
            systemMessage: 'Test',
            platform: 'openai',
            model: 'gpt-4',
          },
        ],
      };

      // This will try to create the agent, which requires a provider
      // We'll test that it attempts to create the agent
      // In a real scenario, we'd mock the agent creation
    });
  });

  describe('getPipeline', () => {
    test('should return pipeline by ID', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);
      const pipeline = manager.getPipeline('test-pipeline');

      expect(pipeline).toBeDefined();
      expect(pipeline?.id).toBe('test-pipeline');
    });

    test('should return undefined for non-existent pipeline', () => {
      const pipeline = manager.getPipeline('nonexistent');
      expect(pipeline).toBeUndefined();
    });
  });

  describe('hasPipeline', () => {
    test('should return true for existing pipeline', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);
      expect(manager.hasPipeline('test-pipeline')).toBe(true);
    });

    test('should return false for non-existent pipeline', () => {
      expect(manager.hasPipeline('nonexistent')).toBe(false);
    });
  });

  describe('removePipeline', () => {
    test('should remove existing pipeline', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);
      const removed = manager.removePipeline('test-pipeline');

      expect(removed).toBe(true);
      expect(manager.hasPipeline('test-pipeline')).toBe(false);
    });

    test('should return false when removing non-existent pipeline', () => {
      const removed = manager.removePipeline('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('getAllPipelines', () => {
    test('should return all pipelines', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config1: PipelineConfig = {
        id: 'pipeline-1',
        agents: ['agent-1'],
      };
      const config2: PipelineConfig = {
        id: 'pipeline-2',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config1);
      await manager.createPipeline(config2);

      const pipelines = manager.getAllPipelines();
      expect(pipelines).toHaveLength(2);
      expect(pipelines.map(p => p.id)).toContain('pipeline-1');
      expect(pipelines.map(p => p.id)).toContain('pipeline-2');
    });

    test('should return empty array when no pipelines', () => {
      const pipelines = manager.getAllPipelines();
      expect(pipelines).toEqual([]);
    });
  });

  describe('clear', () => {
    test('should clear all pipelines', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);
      manager.clear();

      expect(manager.getAllPipelines()).toHaveLength(0);
    });
  });

  describe('matchPipelineByUtterance', () => {
    test('should match exact utterance', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['hello', 'hi'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('hello');

      expect(match).not.toBeNull();
      expect(match?.pipelineId).toBe('test-pipeline');
      expect(match?.confidence).toBe(1.0);
      expect(match?.matchType).toBe('exact');
    });

    test('should match case-insensitive', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['Hello'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('HELLO');

      expect(match).not.toBeNull();
      expect(match?.matchType).toBe('exact');
    });

    test('should match regex pattern', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['weather in (.+)'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('weather in New York');

      expect(match).not.toBeNull();
      expect(match?.pipelineId).toBe('test-pipeline');
      expect(match?.confidence).toBe(0.8);
      expect(match?.matchType).toBe('regex');
    });

    test('should skip invalid regex patterns', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['[invalid regex'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('test');

      expect(match).toBeNull();
    });

    test('should use semantic matcher when provided', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['hello'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const semanticMatcher = async (message: string, utterances: string[]) => {
        return {
          matched: true,
          confidence: 0.9,
          utterance: 'hello',
        };
      };

      const match = await manager.matchPipelineByUtterance('hey there', semanticMatcher);

      expect(match).not.toBeNull();
      expect(match?.pipelineId).toBe('test-pipeline');
      expect(match?.matchType).toBe('semantic');
      expect(match?.confidence).toBe(0.9);
    });

    test('should return null when no match found', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['hello'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('goodbye');

      expect(match).toBeNull();
    });

    test('should only match pipelines with utterances', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const configWithUtterances: PipelineConfig = {
        id: 'pipeline-1',
        utterances: ['hello'],
        agents: ['agent-1'],
      };
      const configWithoutUtterances: PipelineConfig = {
        id: 'pipeline-2',
        agents: ['agent-1'],
      };

      await manager.createPipeline(configWithUtterances);
      await manager.createPipeline(configWithoutUtterances);

      const match = await manager.matchPipelineByUtterance('hello');

      expect(match?.pipelineId).toBe('pipeline-1');
    });

    test('should prioritize exact match over regex', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        utterances: ['hello', '^hello'],
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const match = await manager.matchPipelineByUtterance('hello');

      expect(match?.matchType).toBe('exact');
      expect(match?.confidence).toBe(1.0);
    });
  });

  describe('executePipeline', () => {
    test('should throw error for non-existent pipeline', async () => {
      await expect(manager.executePipeline('nonexistent', 'test message')).rejects.toThrow(
        'Pipeline not found: nonexistent'
      );
    });

    test('should validate message length', async () => {
      const agent1 = createMockAgent('agent-1');
      agentManager['agents'].set('agent-1', agent1);

      const config: PipelineConfig = {
        id: 'test-pipeline',
        agents: ['agent-1'],
      };

      await manager.createPipeline(config);

      const longMessage = 'a'.repeat(1000001);

      await expect(manager.executePipeline('test-pipeline', longMessage)).rejects.toThrow(
        'Message exceeds maximum length'
      );
    });

    test('should validate pipeline ID format', async () => {
      await expect(manager.executePipeline('invalid id', 'test')).rejects.toThrow();
    });
  });
});
