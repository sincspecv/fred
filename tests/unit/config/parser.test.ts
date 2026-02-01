import { describe, test, expect } from 'bun:test';
import { parseConfig, detectConfigFormat } from '../../../packages/core/src/config/parser';
import { FrameworkConfig } from '../../../packages/core/src/config/types';

describe('Config Parser', () => {
  describe('parseConfig - JSON', () => {
    test('should parse valid JSON config', () => {
      const jsonContent = JSON.stringify({
        agents: [
          {
            id: 'test-agent',
            systemMessage: 'You are a test agent',
            platform: 'openai',
            model: 'gpt-4',
          },
        ],
      });

      const config = parseConfig(jsonContent, 'json');

      expect(config).toBeDefined();
      expect(config.agents).toHaveLength(1);
      expect(config.agents?.[0].id).toBe('test-agent');
    });

    test('should parse JSON with intents', () => {
      const jsonContent = JSON.stringify({
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
      });

      const config = parseConfig(jsonContent, 'json');

      expect(config.intents).toHaveLength(1);
      expect(config.intents?.[0].id).toBe('greeting');
    });

    test('should parse JSON with tools', () => {
      const jsonContent = JSON.stringify({
        tools: [
          {
            id: 'test-tool',
            name: 'Test Tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const config = parseConfig(jsonContent, 'json');

      expect(config.tools).toHaveLength(1);
      expect(config.tools?.[0].id).toBe('test-tool');
    });

    test('should throw error for invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => {
        parseConfig(invalidJson, 'json');
      }).toThrow();
    });

    test('should parse empty JSON object', () => {
      const config = parseConfig('{}', 'json');
      expect(config).toEqual({});
    });
  });

  describe('parseConfig - YAML', () => {
    test('should parse valid YAML config', () => {
      const yamlContent = `
agents:
  - id: test-agent
    systemMessage: You are a test agent
    platform: openai
    model: gpt-4
`;

      const config = parseConfig(yamlContent, 'yaml');

      expect(config).toBeDefined();
      expect(config.agents).toHaveLength(1);
      expect(config.agents?.[0].id).toBe('test-agent');
    });

    test('should parse YAML with intents', () => {
      const yamlContent = `
intents:
  - id: greeting
    utterances:
      - hello
      - hi
    action:
      type: agent
      target: greeting-agent
`;

      const config = parseConfig(yamlContent, 'yaml');

      expect(config.intents).toHaveLength(1);
      expect(config.intents?.[0].id).toBe('greeting');
      expect(config.intents?.[0].utterances).toHaveLength(2);
    });

    test('should parse YAML with pipelines', () => {
      const yamlContent = `
pipelines:
  - id: test-pipeline
    agents:
      - test-agent-1
      - test-agent-2
`;

      const config = parseConfig(yamlContent, 'yaml');

      expect(config.pipelines).toHaveLength(1);
      expect(config.pipelines?.[0].id).toBe('test-pipeline');
      expect(config.pipelines?.[0].agents).toHaveLength(2);
    });

    test('should accept yml format alias', () => {
      const yamlContent = `
agents:
  - id: test-agent
    systemMessage: Test
    platform: openai
    model: gpt-4
`;

      const config = parseConfig(yamlContent, 'yml');

      expect(config).toBeDefined();
      expect(config.agents).toHaveLength(1);
    });

    test('should throw error for invalid YAML', () => {
      const invalidYaml = 'invalid: yaml: content: [';

      expect(() => {
        parseConfig(invalidYaml, 'yaml');
      }).toThrow();
    });

    test('should parse empty YAML', () => {
      const config = parseConfig('', 'yaml');
      // Empty YAML returns undefined from js-yaml
      expect(config === undefined || config === null || typeof config === 'object').toBe(true);
    });
  });

  describe('detectConfigFormat', () => {
    test('should detect JSON format from .json extension', () => {
      const format = detectConfigFormat('config.json');
      expect(format).toBe('json');
    });

    test('should detect JSON format from .jsonc extension', () => {
      const format = detectConfigFormat('config.jsonc');
      expect(format).toBe('json');
    });

    test('should detect YAML format from .yaml extension', () => {
      const format = detectConfigFormat('config.yaml');
      expect(format).toBe('yaml');
    });

    test('should detect YAML format from .yml extension', () => {
      const format = detectConfigFormat('config.yml');
      expect(format).toBe('yaml');
    });

    test('should be case-insensitive for extensions', () => {
      expect(detectConfigFormat('config.JSON')).toBe('json');
      expect(detectConfigFormat('config.YAML')).toBe('yaml');
      expect(detectConfigFormat('config.YML')).toBe('yaml');
    });

    test('should throw error for unsupported extension', () => {
      expect(() => {
        detectConfigFormat('config.txt');
      }).toThrow('Cannot detect config format from extension: .txt');
    });

    test('should throw error for file without extension', () => {
      expect(() => {
        detectConfigFormat('config');
      }).toThrow('Cannot detect config format from extension:');
    });
  });

  describe('parseConfig - error handling', () => {
    test('should throw error for unsupported format', () => {
      expect(() => {
        parseConfig('{}', 'xml' as any);
      }).toThrow('Unsupported config format: xml');
    });

    test('should handle complex nested JSON structures', () => {
      const jsonContent = JSON.stringify({
        agents: [
          {
            id: 'agent-1',
            systemMessage: 'Agent 1',
            platform: 'openai',
            model: 'gpt-4',
            tools: ['tool-1', 'tool-2'],
            metadata: {
              version: '1.0',
              tags: ['test', 'example'],
            },
          },
        ],
      });

      const config = parseConfig(jsonContent, 'json');

      expect(config.agents?.[0].tools).toEqual(['tool-1', 'tool-2']);
      expect(config.agents?.[0].metadata?.version).toBe('1.0');
    });

    test('should handle complex nested YAML structures', () => {
      const yamlContent = `
agents:
  - id: agent-1
    systemMessage: Agent 1
    platform: openai
    model: gpt-4
    tools:
      - tool-1
      - tool-2
    metadata:
      version: "1.0"
      tags:
        - test
        - example
`;

      const config = parseConfig(yamlContent, 'yaml');

      expect(config.agents?.[0].tools).toEqual(['tool-1', 'tool-2']);
      expect(config.agents?.[0].metadata?.version).toBe('1.0');
    });
  });
});
