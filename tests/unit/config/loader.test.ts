import { describe, test, expect, beforeEach } from 'bun:test';
import { validateConfig, extractIntents, extractAgents, extractTools, extractPipelines } from '../../../src/config/loader';
import { FrameworkConfig } from '../../../src/config/types';

describe('Config Loader', () => {
  describe('validateConfig', () => {
    describe('intent validation', () => {
      test('should validate valid intents', () => {
        const config: FrameworkConfig = {
          intents: [
            {
              id: 'greeting',
              utterances: ['hello', 'hi'],
              action: {
                type: 'agent',
                target: 'greeting-agent',
              },
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when intent missing id', () => {
        const config: FrameworkConfig = {
          intents: [
            {
              id: '',
              utterances: ['hello'],
              action: {
                type: 'agent',
                target: 'agent',
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Intent must have an id');
      });

      test('should throw error when intent missing utterances', () => {
        const config: FrameworkConfig = {
          intents: [
            {
              id: 'greeting',
              utterances: [],
              action: {
                type: 'agent',
                target: 'agent',
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Intent "greeting" must have at least one utterance');
      });

      test('should throw error when intent missing action', () => {
        const config: FrameworkConfig = {
          intents: [
            {
              id: 'greeting',
              utterances: ['hello'],
              action: {} as any,
            },
          ],
        };

        // The validation checks for type and target, not just action existence
        expect(() => validateConfig(config)).toThrow('Intent "greeting" action must have type and target');
      });

      test('should throw error when intent action missing type or target', () => {
        const config1: FrameworkConfig = {
          intents: [
            {
              id: 'greeting',
              utterances: ['hello'],
              action: {
                type: 'agent',
                target: '',
              },
            },
          ],
        };

        expect(() => validateConfig(config1)).toThrow('Intent "greeting" action must have type and target');
      });
    });

    describe('agent validation', () => {
      test('should validate valid agents', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'test-agent',
              systemMessage: 'You are a test agent',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when agent missing id', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: '',
              systemMessage: 'Test',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Agent must have an id');
      });

      test('should throw error when agent missing systemMessage', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'test-agent',
              systemMessage: '',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow(
          'Agent "test-agent" must have a systemMessage or defaultSystemMessage must be configured'
        );
      });

      test('should allow agent without systemMessage when defaultSystemMessage configured', () => {
        const config: FrameworkConfig = {
          defaultSystemMessage: 'You are a default agent',
          agents: [
            {
              id: 'test-agent',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when agent missing platform', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'test-agent',
              systemMessage: 'Test',
              platform: '',
              model: 'gpt-4',
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Agent "test-agent" must have a platform');
      });

      test('should throw error when agent missing model', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'test-agent',
              systemMessage: 'Test',
              platform: 'openai',
              model: '',
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Agent "test-agent" must have a model');
      });
    });

    describe('tool validation', () => {
      test('should validate valid tools', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: 'Test Tool',
              description: 'A test tool',
              schema: {
                metadata: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should allow tools without schema metadata when not strict', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: 'Test Tool',
              description: 'A test tool',
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when tool missing id', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: '',
              name: 'Test Tool',
              description: 'Test',
              schema: {
                metadata: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Tool must have an id');
      });

      test('should throw error when tool missing name', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: '',
              description: 'Test',
              schema: {
                metadata: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Tool "test-tool" must have a name');
      });

      test('should throw error when tool missing description', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: 'Test Tool',
              description: '',
              schema: {
                metadata: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Tool "test-tool" must have a description');
      });

      test('should throw error when strict tool missing schema metadata', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: 'Test Tool',
              description: 'Test',
              strict: true,
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Tool "test-tool" requires schema metadata when strict mode is enabled');
      });

      test('should throw error when schema metadata is invalid', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'test-tool',
              name: 'Test Tool',
              description: 'Test',
              schema: {
                metadata: {
                  type: 'string' as any,
                  properties: {},
                },
              },
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Tool "test-tool" schema metadata must be type "object"');
      });
    });

    describe('pipeline validation', () => {
      test('should validate valid pipelines', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'test-pipeline',
              agents: ['agent-1', 'agent-2'],
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when pipeline missing id', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: '',
              agents: ['agent-1'],
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Pipeline must have an id');
      });

      test('should throw error for duplicate pipeline IDs', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'pipeline-1',
              agents: ['agent-1'],
            },
            {
              id: 'pipeline-1',
              agents: ['agent-2'],
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Duplicate pipeline ID found: "pipeline-1"');
      });

      test('should throw error when pipeline missing agents', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'test-pipeline',
              agents: [],
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Pipeline "test-pipeline" must have at least one agent');
      });

      test('should validate inline agent configs', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'test-pipeline',
              agents: [
                {
                  id: 'inline-agent',
                  systemMessage: 'Test',
                  platform: 'openai',
                  model: 'gpt-4',
                },
              ],
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error when inline agent missing id', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'test-pipeline',
              agents: [
                {
                  id: '',
                  systemMessage: 'Test',
                  platform: 'openai',
                  model: 'gpt-4',
                },
              ],
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow('Pipeline "test-pipeline" has inline agent at index 0 without an id');
      });

      test('should throw error when inline agent missing systemMessage', () => {
        const config: FrameworkConfig = {
          pipelines: [
            {
              id: 'test-pipeline',
              agents: [
                {
                  id: 'inline-agent',
                  systemMessage: '',
                  platform: 'openai',
                  model: 'gpt-4',
                },
              ],
            },
          ],
        };

        expect(() => validateConfig(config)).toThrow(
          'Pipeline "test-pipeline" has inline agent "inline-agent" without a systemMessage or defaultSystemMessage'
        );
      });

      test('should allow inline agent without systemMessage when defaultSystemMessage configured', () => {
        const config: FrameworkConfig = {
          defaultSystemMessage: 'Default prompt',
          pipelines: [
            {
              id: 'test-pipeline',
              agents: [
                {
                  id: 'inline-agent',
                  platform: 'openai',
                  model: 'gpt-4',
                },
              ],
            },
          ],
        };

        expect(() => validateConfig(config)).not.toThrow();
      });
    });

    test('should validate empty config', () => {
      const config: FrameworkConfig = {};
      expect(() => validateConfig(config)).not.toThrow();
    });

    test('should allow memory defaults', () => {
      const config: FrameworkConfig = {
        memory: {
          policy: {
            maxMessages: 25,
            maxChars: 1000,
            strict: true,
            isolated: true,
          },
          requireConversationId: true,
          sequentialVisibility: false,
        },
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    describe('persistence validation', () => {
      test('should accept postgres adapter', () => {
        const config: FrameworkConfig = {
          persistence: {
            adapter: 'postgres',
          },
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should accept sqlite adapter', () => {
        const config: FrameworkConfig = {
          persistence: {
            adapter: 'sqlite',
          },
        };

        expect(() => validateConfig(config)).not.toThrow();
      });

      test('should throw error for invalid adapter', () => {
        const config: FrameworkConfig = {
          persistence: {
            adapter: 'mysql' as any,
          },
        };

        expect(() => validateConfig(config)).toThrow(
          'Invalid persistence adapter "mysql". Valid adapters are: postgres, sqlite'
        );
      });

      test('should allow config without persistence', () => {
        const config: FrameworkConfig = {};

        expect(() => validateConfig(config)).not.toThrow();
      });
    });
  });

  describe('extractIntents', () => {
    test('should extract intents from config', () => {
      const config: FrameworkConfig = {
        intents: [
          {
            id: 'greeting',
            utterances: ['hello'],
            action: {
              type: 'agent',
              target: 'agent',
            },
          },
        ],
      };

      const intents = extractIntents(config);
      expect(intents).toHaveLength(1);
      expect(intents[0].id).toBe('greeting');
    });

    test('should return empty array when no intents', () => {
      const config: FrameworkConfig = {};
      const intents = extractIntents(config);
      expect(intents).toEqual([]);
    });
  });

    describe('extractAgents', () => {
      test('should extract agents from config', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'agent-1',
              systemMessage: 'Agent 1',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

      const agents = extractAgents(config);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-1');
    });

    test('should return empty array when no agents', () => {
      const config: FrameworkConfig = {};
      const agents = extractAgents(config);
      expect(agents).toEqual([]);
    });

      test('should handle basePath for prompt file resolution', () => {
        const config: FrameworkConfig = {
          agents: [
            {
              id: 'agent-1',
              systemMessage: './prompts/agent.md',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

      const agents = extractAgents(config, '/path/to/config.yaml');
      expect(agents).toHaveLength(1);
      // loadPromptFile will attempt to resolve the path
      // If file doesn't exist, it returns the original string
        expect(agents[0].systemMessage).toBeDefined();
      });

      test('should apply default system message when agent systemMessage missing', () => {
        const config: FrameworkConfig = {
          defaultSystemMessage: 'Default prompt',
          agents: [
            {
              id: 'agent-1',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        };

        const agents = extractAgents(config);
        expect(agents[0].systemMessage).toBe('Default prompt');
      });
    });

  describe('extractTools', () => {
      test('should extract tools from config', () => {
        const config: FrameworkConfig = {
          tools: [
            {
              id: 'tool-1',
              name: 'Tool 1',
              description: 'Description',
              schema: {
                metadata: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          ],
        };

      const tools = extractTools(config);
      expect(tools).toHaveLength(1);
      expect(tools[0].id).toBe('tool-1');
    });

    test('should return empty array when no tools', () => {
      const config: FrameworkConfig = {};
      const tools = extractTools(config);
      expect(tools).toEqual([]);
    });
  });

  describe('extractPipelines', () => {
    test('should extract pipelines from config', () => {
      const config: FrameworkConfig = {
        pipelines: [
          {
            id: 'pipeline-1',
            agents: ['agent-1', 'agent-2'],
          },
        ],
      };

      const pipelines = extractPipelines(config);
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0].id).toBe('pipeline-1');
      expect(pipelines[0].agents).toEqual(['agent-1', 'agent-2']);
    });

    test('should return empty array when no pipelines', () => {
      const config: FrameworkConfig = {};
      const pipelines = extractPipelines(config);
      expect(pipelines).toEqual([]);
    });

    test('should handle inline agent configs', () => {
      const config: FrameworkConfig = {
        pipelines: [
          {
            id: 'pipeline-1',
            agents: [
              {
                id: 'inline-agent',
                systemMessage: './prompt.md',
                platform: 'openai',
                model: 'gpt-4',
              },
            ],
          },
        ],
      };

      const pipelines = extractPipelines(config, '/path/to/config.yaml');
      expect(pipelines).toHaveLength(1);
      expect(typeof pipelines[0].agents[0]).toBe('object');
      expect((pipelines[0].agents[0] as any).id).toBe('inline-agent');
    });

    test('should preserve utterances when present', () => {
      const config: FrameworkConfig = {
        pipelines: [
          {
            id: 'pipeline-1',
            utterances: ['hello', 'hi'],
            agents: ['agent-1'],
          },
        ],
      };

      const pipelines = extractPipelines(config);
      expect(pipelines[0].utterances).toEqual(['hello', 'hi']);
    });

    test('should create deep copy to prevent mutation', () => {
      const config: FrameworkConfig = {
        pipelines: [
          {
            id: 'pipeline-1',
            agents: ['agent-1'],
          },
        ],
      };

      const pipelines = extractPipelines(config);
      pipelines[0].agents.push('agent-2');

      // Original config should not be mutated
      expect(config.pipelines?.[0].agents).toEqual(['agent-1']);
    });
  });
});
