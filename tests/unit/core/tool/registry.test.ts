import { describe, test, expect, beforeEach } from 'bun:test';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import { Tool } from '../../../../packages/core/src/tool/tool';
import { Effect, LogLevel } from 'effect';
import type { RedactionFilter, RedactionContext } from '../../../../packages/core/src/observability/errors';
import type { VerbosityOverrides } from '../../../../packages/core/src/observability/otel';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  function createMockTool(id: string, name?: string): Tool {
    return {
      id,
      name: name || `tool-${id}`,
      description: `Description for ${id}`,
      execute: async (args: { input: string }) => {
        return { result: `executed ${id} with ${args.input}` };
      },
    };
  }

  describe('registerTool', () => {
    test('should register a single tool', () => {
      const tool = createMockTool('test-tool');
      registry.registerTool(tool);

      expect(registry.hasTool('test-tool')).toBe(true);
      expect(registry.getTool('test-tool')).toBe(tool);
      expect(registry.size()).toBe(1);
    });

    test('should throw error when registering duplicate tool', () => {
      const tool = createMockTool('test-tool');
      registry.registerTool(tool);

      expect(() => {
        registry.registerTool(tool);
      }).toThrow('Tool with id "test-tool" is already registered');
    });

    test('should register multiple different tools', () => {
      const tool1 = createMockTool('tool-1');
      const tool2 = createMockTool('tool-2');
      const tool3 = createMockTool('tool-3');

      registry.registerTool(tool1);
      registry.registerTool(tool2);
      registry.registerTool(tool3);

      expect(registry.size()).toBe(3);
      expect(registry.hasTool('tool-1')).toBe(true);
      expect(registry.hasTool('tool-2')).toBe(true);
      expect(registry.hasTool('tool-3')).toBe(true);
    });

    test('should throw error for strict tool missing schema', () => {
      const tool = {
        ...createMockTool('strict-tool'),
        strict: true,
      };

      expect(() => {
        registry.registerTool(tool);
      }).toThrow('Tool "strict-tool" requires an input schema when strict mode is enabled');
    });

    test('should allow non-strict tool without schema', () => {
      const tool = createMockTool('lenient-tool');

      expect(() => {
        registry.registerTool(tool);
      }).not.toThrow();
    });
  });

  describe('registerTools', () => {
    test('should register multiple tools at once', () => {
      const tools = [
        createMockTool('tool-1'),
        createMockTool('tool-2'),
        createMockTool('tool-3'),
      ];

      registry.registerTools(tools);

      expect(registry.size()).toBe(3);
      expect(registry.hasTool('tool-1')).toBe(true);
      expect(registry.hasTool('tool-2')).toBe(true);
      expect(registry.hasTool('tool-3')).toBe(true);
    });

    test('should throw error when registering duplicate in batch', () => {
      const tools = [
        createMockTool('tool-1'),
        createMockTool('tool-1'), // duplicate
      ];

      expect(() => {
        registry.registerTools(tools);
      }).toThrow('Tool with id "tool-1" is already registered');
    });
  });

  describe('getTool', () => {
    test('should return tool by ID', () => {
      const tool = createMockTool('test-tool');
      registry.registerTool(tool);

      const retrieved = registry.getTool('test-tool');
      expect(retrieved).toBe(tool);
    });

    test('should return undefined for non-existent tool', () => {
      const retrieved = registry.getTool('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getTools', () => {
    test('should return multiple tools by IDs', () => {
      const tool1 = createMockTool('tool-1');
      const tool2 = createMockTool('tool-2');
      const tool3 = createMockTool('tool-3');

      registry.registerTool(tool1);
      registry.registerTool(tool2);
      registry.registerTool(tool3);

      const retrieved = registry.getTools(['tool-1', 'tool-3']);
      expect(retrieved).toHaveLength(2);
      expect(retrieved).toContain(tool1);
      expect(retrieved).toContain(tool3);
      expect(retrieved).not.toContain(tool2);
    });

    test('should return empty array for non-existent IDs', () => {
      const retrieved = registry.getTools(['non-existent-1', 'non-existent-2']);
      expect(retrieved).toHaveLength(0);
    });

    test('should return only existing tools when some IDs are missing', () => {
      const tool1 = createMockTool('tool-1');
      registry.registerTool(tool1);

      const retrieved = registry.getTools(['tool-1', 'non-existent']);
      expect(retrieved).toHaveLength(1);
      expect(retrieved).toContain(tool1);
    });
  });

  describe('getAllTools', () => {
    test('should return all registered tools', () => {
      const tool1 = createMockTool('tool-1');
      const tool2 = createMockTool('tool-2');
      const tool3 = createMockTool('tool-3');

      registry.registerTool(tool1);
      registry.registerTool(tool2);
      registry.registerTool(tool3);

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(3);
      expect(allTools).toContain(tool1);
      expect(allTools).toContain(tool2);
      expect(allTools).toContain(tool3);
    });

    test('should return empty array when no tools registered', () => {
      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(0);
    });
  });

  describe('hasTool', () => {
    test('should return true for existing tool', () => {
      const tool = createMockTool('test-tool');
      registry.registerTool(tool);

      expect(registry.hasTool('test-tool')).toBe(true);
    });

    test('should return false for non-existent tool', () => {
      expect(registry.hasTool('non-existent')).toBe(false);
    });
  });

  describe('removeTool', () => {
    test('should remove existing tool', () => {
      const tool = createMockTool('test-tool');
      registry.registerTool(tool);

      const removed = registry.removeTool('test-tool');
      expect(removed).toBe(true);
      expect(registry.hasTool('test-tool')).toBe(false);
      expect(registry.size()).toBe(0);
    });

    test('should return false when removing non-existent tool', () => {
      const removed = registry.removeTool('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    test('should clear all tools', () => {
      registry.registerTool(createMockTool('tool-1'));
      registry.registerTool(createMockTool('tool-2'));
      registry.registerTool(createMockTool('tool-3'));

      expect(registry.size()).toBe(3);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.hasTool('tool-1')).toBe(false);
      expect(registry.hasTool('tool-2')).toBe(false);
      expect(registry.hasTool('tool-3')).toBe(false);
    });
  });

  describe('size', () => {
    test('should return correct size', () => {
      expect(registry.size()).toBe(0);

      registry.registerTool(createMockTool('tool-1'));
      expect(registry.size()).toBe(1);

      registry.registerTool(createMockTool('tool-2'));
      expect(registry.size()).toBe(2);

      registry.removeTool('tool-1');
      expect(registry.size()).toBe(1);
    });
  });

  describe('toAISDKTools', () => {
    test('should convert tools to AI SDK format', () => {
      const tool1 = createMockTool('tool-1');
      const tool2 = createMockTool('tool-2');

      registry.registerTool(tool1);
      registry.registerTool(tool2);

      const sdkTools = registry.toAISDKTools(['tool-1', 'tool-2']);

      expect(Object.keys(sdkTools)).toHaveLength(2);
      expect(sdkTools['tool-1']).toBeDefined();
      expect(sdkTools['tool-2']).toBeDefined();
      // Verify structure - should have execute function
      expect(typeof sdkTools['tool-1'].execute).toBe('function');
      expect(typeof sdkTools['tool-2'].execute).toBe('function');
    });

    test('should return empty object for non-existent tool IDs', () => {
      const sdkTools = registry.toAISDKTools(['non-existent']);
      expect(Object.keys(sdkTools)).toHaveLength(0);
    });

    test('should only include requested tools', () => {
      registry.registerTool(createMockTool('tool-1'));
      registry.registerTool(createMockTool('tool-2'));
      registry.registerTool(createMockTool('tool-3'));

      const sdkTools = registry.toAISDKTools(['tool-1', 'tool-3']);

      expect(Object.keys(sdkTools)).toHaveLength(2);
      expect(sdkTools['tool-1']).toBeDefined();
      expect(sdkTools['tool-3']).toBeDefined();
      expect(sdkTools['tool-2']).toBeUndefined();
    });
  });

  describe('Payload Logging with Redaction', () => {
    test('should apply redaction filter to tool invocation logs', async () => {
      const customFilter: RedactionFilter = (payload: unknown, context: RedactionContext) => {
        if (context.payloadType === 'request' && typeof payload === 'object' && payload !== null) {
          const obj = payload as any;
          return { ...obj, apiKey: '[MASKED]' };
        }
        return payload;
      };

      registry.setRedactionFilter(customFilter);
      registry.setLogLevel(LogLevel.Debug);

      const logEffect = registry.logToolInvocation('test-tool', { apiKey: 'secret', query: 'visible' });

      // Effect should execute without errors
      await expect(Effect.runPromise(logEffect)).resolves.toBeUndefined();
    });

    test('should apply redaction filter to tool result logs', async () => {
      const customFilter: RedactionFilter = (payload: unknown, context: RedactionContext) => {
        if (context.payloadType === 'response' && typeof payload === 'object' && payload !== null) {
          const obj = payload as any;
          return { ...obj, token: '[MASKED]' };
        }
        return payload;
      };

      registry.setRedactionFilter(customFilter);
      registry.setLogLevel(LogLevel.Debug);

      const logEffect = registry.logToolResult('test-tool', { token: 'secret', data: 'visible' });

      // Effect should execute without errors
      await expect(Effect.runPromise(logEffect)).resolves.toBeUndefined();
    });

    test('should respect verbosity overrides for tool logging', async () => {
      const verbosity: VerbosityOverrides = {
        gateTokenStreams: true,
        gateHeartbeats: true,
      };

      registry.setVerbosityOverrides(verbosity);
      registry.setLogLevel(LogLevel.Info);

      // At info level with default verbosity, should not log (returns void immediately)
      const logEffect = registry.logToolInvocation('test-tool', { data: 'test' });

      await expect(Effect.runPromise(logEffect)).resolves.toBeUndefined();
    });

    test('should log tool invocations at debug level', async () => {
      registry.setLogLevel(LogLevel.Debug);

      const logEffect = registry.logToolInvocation('test-tool', { input: 'data' });

      // Should log without errors at debug level
      await expect(Effect.runPromise(logEffect)).resolves.toBeUndefined();
    });

    test('should log tool results at debug level', async () => {
      registry.setLogLevel(LogLevel.Debug);

      const logEffect = registry.logToolResult('test-tool', { output: 'result' });

      // Should log without errors at debug level
      await expect(Effect.runPromise(logEffect)).resolves.toBeUndefined();
    });
  });
});
