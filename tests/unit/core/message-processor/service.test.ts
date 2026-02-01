import { describe, test, expect } from 'bun:test';
import { Effect, Layer, Ref } from 'effect';
import {
  MessageProcessorService,
  MessageProcessorServiceLive,
  MessageProcessorServiceLiveWithConfig,
  type MessageProcessorConfig,
} from '../../../../packages/core/src/message-processor/service';
import {
  MessageValidationError,
  NoRouteFoundError,
  RouteExecutionError,
  HandoffError,
  ConversationIdRequiredError,
  AgentNotFoundError,
  MaxHandoffDepthError,
} from '../../../../packages/core/src/message-processor/errors';
import {
  isToolFailureRecord,
  type ToolFailureRecord,
} from '../../../../packages/core/src/message-processor/types';
import { AgentService } from '../../../../packages/core/src/agent/service';
import { PipelineService } from '../../../../packages/core/src/pipeline/service';
import { ContextStorageService } from '../../../../packages/core/src/context/service';

describe('MessageProcessorService Error Types', () => {
  test('MessageValidationError creates correct structure', () => {
    const error = new MessageValidationError({ message: 'Too long', details: 'exceeds 10000 chars' });
    expect(error._tag).toBe('MessageValidationError');
    expect(error.message).toBe('Too long');
    expect(error.details).toBe('exceeds 10000 chars');
  });

  test('NoRouteFoundError creates correct structure', () => {
    const error = new NoRouteFoundError({ message: 'Hello' });
    expect(error._tag).toBe('NoRouteFoundError');
    expect(error.message).toBe('Hello');
  });

  test('RouteExecutionError creates correct structure', () => {
    const cause = new Error('Agent failed');
    const error = new RouteExecutionError({ routeType: 'agent', cause });
    expect(error._tag).toBe('RouteExecutionError');
    expect(error.routeType).toBe('agent');
    expect(error.cause).toBe(cause);
  });

  test('HandoffError creates correct structure', () => {
    const cause = new Error('Target not found');
    const error = new HandoffError({ fromAgentId: 'agent-a', toAgentId: 'agent-b', cause });
    expect(error._tag).toBe('HandoffError');
    expect(error.fromAgentId).toBe('agent-a');
    expect(error.toAgentId).toBe('agent-b');
    expect(error.cause).toBe(cause);
  });

  test('ConversationIdRequiredError creates correct structure', () => {
    const error = new ConversationIdRequiredError({});
    expect(error._tag).toBe('ConversationIdRequiredError');
  });

  test('AgentNotFoundError creates correct structure', () => {
    const error = new AgentNotFoundError({ agentId: 'missing-agent' });
    expect(error._tag).toBe('AgentNotFoundError');
    expect(error.agentId).toBe('missing-agent');
  });

  test('MaxHandoffDepthError creates correct structure', () => {
    const error = new MaxHandoffDepthError({ depth: 10, maxDepth: 10 });
    expect(error._tag).toBe('MaxHandoffDepthError');
    expect(error.depth).toBe(10);
    expect(error.maxDepth).toBe(10);
  });
});

describe('MessageProcessorService Configuration', () => {
  // Create minimal mock services for testing configuration
  const mockAgentService: AgentService = {
    createAgent: () => Effect.fail({ _tag: 'AgentCreationError' as const, message: 'Not implemented' }),
    getAgent: () => Effect.fail({ _tag: 'AgentNotFoundError' as const, agentId: 'test' }),
    getAgentOptional: () => Effect.succeed(undefined),
    hasAgent: () => Effect.succeed(false),
    removeAgent: () => Effect.succeed(false),
    getAllAgents: () => Effect.succeed([]),
    clear: () => Effect.void,
    setTracer: () => Effect.void,
    setDefaultSystemMessage: () => Effect.void,
    setGlobalVariablesResolver: () => Effect.void,
    matchAgentByUtterance: () => Effect.succeed(null),
    getMCPMetrics: () => Effect.succeed({}),
    registerShutdownHooks: () => Effect.void,
  };

  const mockPipelineService: PipelineService = {
    createPipeline: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    getPipeline: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    getPipelineOptional: () => Effect.succeed(undefined),
    hasPipeline: () => Effect.succeed(false),
    removePipeline: () => Effect.succeed(false),
    getAllPipelines: () => Effect.succeed([]),
    clear: () => Effect.void,
    executePipeline: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    matchPipelineByUtterance: () => Effect.succeed(null),
    createPipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    getPipelineV2: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    executePipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    streamPipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    resumePipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    createGraphWorkflow: () => Effect.fail({ _tag: 'GraphValidationError' as const, errors: [] }),
    getGraphWorkflow: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    executeGraph: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    executeGraphFromYaml: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    executeGraphFromBuilder: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
  } as PipelineService;

  const mockContextStorage: ContextStorageService = {
    generateConversationId: () => Effect.succeed('test-conv-id'),
    getContext: () => Effect.fail({ _tag: 'ContextNotFoundError' as const, conversationId: 'test' }),
    getContextById: () => Effect.succeed(null),
    addMessage: () => Effect.void,
    addMessages: () => Effect.void,
    getHistory: () => Effect.succeed([]),
    updateMetadata: () => Effect.void,
    clearContext: () => Effect.void,
    resetContext: () => Effect.succeed(false),
    clearAll: () => Effect.void,
    setDefaultPolicy: () => Effect.void,
    setStorage: () => Effect.void,
  };

  const testLayer = Layer.mergeAll(
    Layer.succeed(AgentService, mockAgentService),
    Layer.succeed(PipelineService, mockPipelineService),
    Layer.succeed(ContextStorageService, mockContextStorage)
  );

  const runWithMocks = <A, E>(effect: Effect.Effect<A, E, MessageProcessorService>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(MessageProcessorServiceLive),
        Effect.provide(testLayer)
      )
    );

  test('getConfig returns initial configuration', async () => {
    const config = await runWithMocks(
      Effect.gen(function* () {
        const service = yield* MessageProcessorService;
        return yield* service.getConfig();
      })
    );

    expect(config.defaultAgentId).toBeUndefined();
    expect(config.memoryDefaults).toEqual({});
    expect(config.tracer).toBeUndefined();
  });

  test('updateConfig updates configuration', async () => {
    const config = await runWithMocks(
      Effect.gen(function* () {
        const service = yield* MessageProcessorService;
        yield* service.updateConfig({
          defaultAgentId: 'test-agent',
          memoryDefaults: { requireConversationId: true },
        });
        return yield* service.getConfig();
      })
    );

    expect(config.defaultAgentId).toBe('test-agent');
    expect(config.memoryDefaults.requireConversationId).toBe(true);
  });

  test('MessageProcessorServiceLiveWithConfig accepts initial config', async () => {
    const layerWithConfig = MessageProcessorServiceLiveWithConfig({
      defaultAgentId: 'preconfigured-agent',
      memoryDefaults: { sequentialVisibility: false },
    });

    const config = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MessageProcessorService;
        return yield* service.getConfig();
      }).pipe(
        Effect.provide(layerWithConfig),
        Effect.provide(testLayer)
      )
    );

    expect(config.defaultAgentId).toBe('preconfigured-agent');
    expect(config.memoryDefaults.sequentialVisibility).toBe(false);
  });
});

describe('MessageProcessorService Routing', () => {
  // Create mock services that simulate no agent/pipeline/intent matches
  const mockAgentService: AgentService = {
    createAgent: () => Effect.fail({ _tag: 'AgentCreationError' as const, message: 'Not implemented' }),
    getAgent: () => Effect.fail({ _tag: 'AgentNotFoundError' as const, agentId: 'test' }),
    getAgentOptional: () => Effect.succeed(undefined),
    hasAgent: () => Effect.succeed(false),
    removeAgent: () => Effect.succeed(false),
    getAllAgents: () => Effect.succeed([]),
    clear: () => Effect.void,
    setTracer: () => Effect.void,
    setDefaultSystemMessage: () => Effect.void,
    setGlobalVariablesResolver: () => Effect.void,
    matchAgentByUtterance: () => Effect.succeed(null),
    getMCPMetrics: () => Effect.succeed({}),
    registerShutdownHooks: () => Effect.void,
  };

  const mockPipelineService: PipelineService = {
    createPipeline: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    getPipeline: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    getPipelineOptional: () => Effect.succeed(undefined),
    hasPipeline: () => Effect.succeed(false),
    removePipeline: () => Effect.succeed(false),
    getAllPipelines: () => Effect.succeed([]),
    clear: () => Effect.void,
    executePipeline: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    matchPipelineByUtterance: () => Effect.succeed(null),
    createPipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    getPipelineV2: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    executePipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    streamPipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    resumePipelineV2: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    createGraphWorkflow: () => Effect.fail({ _tag: 'GraphValidationError' as const, errors: [] }),
    getGraphWorkflow: () => Effect.fail({ _tag: 'PipelineNotFoundError' as const, pipelineId: 'test' }),
    executeGraph: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    executeGraphFromYaml: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
    executeGraphFromBuilder: () => Effect.fail({ _tag: 'PipelineExecutionError' as const, message: 'Not implemented' }),
  } as PipelineService;

  const mockContextStorage: ContextStorageService = {
    generateConversationId: () => Effect.succeed('test-conv-id'),
    getContext: () => Effect.fail({ _tag: 'ContextNotFoundError' as const, conversationId: 'test' }),
    getContextById: () => Effect.succeed(null),
    addMessage: () => Effect.void,
    addMessages: () => Effect.void,
    getHistory: () => Effect.succeed([]),
    updateMetadata: () => Effect.void,
    clearContext: () => Effect.void,
    resetContext: () => Effect.succeed(false),
    clearAll: () => Effect.void,
    setDefaultPolicy: () => Effect.void,
    setStorage: () => Effect.void,
  };

  const testLayer = Layer.mergeAll(
    Layer.succeed(AgentService, mockAgentService),
    Layer.succeed(PipelineService, mockPipelineService),
    Layer.succeed(ContextStorageService, mockContextStorage)
  );

  const runWithMocks = <A, E>(effect: Effect.Effect<A, E, MessageProcessorService>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(MessageProcessorServiceLive),
        Effect.provide(testLayer)
      )
    );

  test('routeMessage returns none when no routes match', async () => {
    const result = await runWithMocks(
      Effect.gen(function* () {
        const service = yield* MessageProcessorService;
        return yield* service.routeMessage('Hello');
      })
    );

    expect(result.type).toBe('none');
  });

  test('processMessage fails with NoRouteFoundError when no routes match', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* MessageProcessorService;
        return yield* service.processMessage('Hello');
      }).pipe(
        Effect.provide(MessageProcessorServiceLive),
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
  });
});

describe('ToolFailure Record Type', () => {
  test('isToolFailureRecord returns true for valid ToolFailure records', () => {
    const failureRecord: ToolFailureRecord = {
      __type: 'ToolFailure',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      },
      output: 'Error: Invalid input',
    };

    expect(isToolFailureRecord(failureRecord)).toBe(true);
  });

  test('isToolFailureRecord returns false for success records', () => {
    const successRecord = {
      result: 'success data',
    };

    expect(isToolFailureRecord(successRecord)).toBe(false);
  });

  test('isToolFailureRecord returns false for null', () => {
    expect(isToolFailureRecord(null)).toBe(false);
  });

  test('isToolFailureRecord returns false for undefined', () => {
    expect(isToolFailureRecord(undefined)).toBe(false);
  });

  test('isToolFailureRecord returns false for primitives', () => {
    expect(isToolFailureRecord('string')).toBe(false);
    expect(isToolFailureRecord(123)).toBe(false);
    expect(isToolFailureRecord(true)).toBe(false);
  });

  test('isToolFailureRecord returns false for wrong __type', () => {
    const wrongType = {
      __type: 'ToolResult',
      result: 'data',
    };

    expect(isToolFailureRecord(wrongType)).toBe(false);
  });

  test('isToolFailureRecord returns false for missing error field', () => {
    const missingError = {
      __type: 'ToolFailure',
      output: 'data',
    };

    expect(isToolFailureRecord(missingError)).toBe(false);
  });

  test('ToolFailure record contains error code and message', () => {
    const failureRecord: ToolFailureRecord = {
      __type: 'ToolFailure',
      error: {
        code: 'TIMEOUT_ERROR',
        message: 'Tool execution timed out after 30000ms',
      },
      output: 'Error: Tool execution timed out',
    };

    expect(failureRecord.error.code).toBe('TIMEOUT_ERROR');
    expect(failureRecord.error.message).toBe('Tool execution timed out after 30000ms');
  });

  test('toolCallId correlation is maintained via tool-result id field', () => {
    // This test verifies the conceptual structure - toolCallId is preserved
    // in the id field of Prompt.makePart('tool-result', {...})
    const mockToolResult = {
      id: 'call_abc123',
      name: 'test_tool',
      result: {
        __type: 'ToolFailure' as const,
        error: { code: 'ERROR', message: 'Failed' },
        output: 'Error message',
      },
      isFailure: true,
    };

    expect(mockToolResult.id).toBe('call_abc123');
    expect(isToolFailureRecord(mockToolResult.result)).toBe(true);
  });
});
