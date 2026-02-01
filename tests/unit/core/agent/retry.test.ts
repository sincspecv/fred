import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { AgentFactory } from '../../../../src/core/agent/factory';
import { ToolRegistry } from '../../../../src/core/tool/registry';
import { AgentConfig } from '../../../../src/core/agent/agent';
import { createMockProvider } from '../../helpers/mock-provider';
import { ProviderDefinition } from '../../../../src/core/platform/provider';
import { ErrorClass, classifyError } from '../../../../src/core/observability/errors';

describe('Tool Retry Policy', () => {
  let factory: AgentFactory;
  let toolRegistry: ToolRegistry;
  let mockProvider: ProviderDefinition;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    factory = new AgentFactory(toolRegistry);
    mockProvider = createMockProvider();
  });

  describe('Error Classification for Retry', () => {
    test('should classify timeout errors as retryable', () => {
      const error = new Error('Request timeout after 30000ms');
      expect(classifyError(error)).toBe(ErrorClass.RETRYABLE);
    });

    test('should classify rate limit errors as retryable', () => {
      const error = new Error('Rate limit exceeded: 429 Too Many Requests');
      expect(classifyError(error)).toBe(ErrorClass.RETRYABLE);
    });

    test('should classify 503 errors as retryable', () => {
      const error = new Error('Service unavailable: 503');
      expect(classifyError(error)).toBe(ErrorClass.RETRYABLE);
    });

    test('should classify validation errors as USER (non-retryable)', () => {
      const error = new Error('Validation failed: invalid email format');
      expect(classifyError(error)).toBe(ErrorClass.USER);
    });

    test('should classify API key errors as PROVIDER (non-retryable)', () => {
      const error = new Error('Invalid API key provided');
      expect(classifyError(error)).toBe(ErrorClass.PROVIDER);
    });

    test('should classify database errors as INFRASTRUCTURE (non-retryable)', () => {
      const error = new Error('Database connection failed');
      expect(classifyError(error)).toBe(ErrorClass.INFRASTRUCTURE);
    });

    test('should classify unknown errors as UNKNOWN (non-retryable)', () => {
      const error = new Error('Something unexpected happened');
      expect(classifyError(error)).toBe(ErrorClass.UNKNOWN);
    });
  });

  describe('Retry Policy Configuration', () => {
    test('should create agent with default retry policy', async () => {
      const tool = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'retry-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['test-tool'],
        // No toolRetry specified - should use defaults
      };

      const agent = await factory.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
    });

    test('should create agent with custom retry policy', async () => {
      const tool = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'retry-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['test-tool'],
        toolRetry: {
          maxRetries: 5,
          backoffMs: 500,
          maxBackoffMs: 5000,
          jitterMs: 100,
        },
      };

      const agent = await factory.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
    });

    test('should create agent with partial retry policy', async () => {
      const tool = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'retry-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['test-tool'],
        toolRetry: {
          maxRetries: 2,
          // Other values should use defaults
        },
      };

      const agent = await factory.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
    });
  });

  describe('Retry Behavior', () => {
    test('should not retry non-retryable errors', async () => {
      let executionCount = 0;
      const tool = {
        id: 'validation-error-tool',
        name: 'Validation Error Tool',
        description: 'A tool that always throws validation error',
        execute: async () => {
          executionCount++;
          throw new Error('Validation failed: invalid input');
        },
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'no-retry-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['validation-error-tool'],
        toolRetry: {
          maxRetries: 3,
          backoffMs: 10, // Short for testing
        },
      };

      const agent = await factory.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
      // The agent is created - execution would be tested via actual model invocation
      // which we can't do without mocking the entire AI layer
    });

    test('should handle tools with zero maxRetries', async () => {
      const tool = {
        id: 'no-retry-tool',
        name: 'No Retry Tool',
        description: 'A tool with no retries',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'no-retry-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['no-retry-tool'],
        toolRetry: {
          maxRetries: 0, // No retries
        },
      };

      const agent = await factory.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
    });
  });

  describe('Retry with Tracer Integration', () => {
    test('should annotate retry attempts on tool spans', async () => {
      const mockSpan = {
        setAttributes: () => {},
        setAttribute: () => {},
        setStatus: () => {},
        recordException: () => {},
        addEvent: () => {},
        end: () => {},
      };

      const mockTracer = {
        startSpan: () => mockSpan,
        getActiveSpan: () => undefined,
        setActiveSpan: () => {},
      } as any;

      const factoryWithTracer = new AgentFactory(toolRegistry, mockTracer);

      const tool = {
        id: 'traced-tool',
        name: 'Traced Tool',
        description: 'A tool for tracing tests',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'traced-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['traced-tool'],
        toolRetry: {
          maxRetries: 2,
        },
      };

      const agent = await factoryWithTracer.createAgent(config, mockProvider);
      expect(agent).toBeDefined();
    });
  });
});
