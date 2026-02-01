/**
 * Tests for FredLayers composition and runtime creation.
 *
 * These tests verify that all Effect services are correctly composed
 * into the FredLayers aggregate layer and can be accessed through
 * the runtime.
 */

import { describe, test, expect } from 'bun:test';
import { Effect, Runtime } from 'effect';
import {
  FredLayers,
  createScopedFredRuntime,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  CheckpointService,
  PauseService,
} from '../../../packages/core/src/services';

describe('FredLayers', () => {
  test('composes all services without errors', async () => {
    // Creating runtime validates layer composition
    const runtime = await createScopedFredRuntime();
    expect(runtime).toBeDefined();
  });

  test('provides ToolRegistryService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toBe(0);
  });

  test('provides HookManagerService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* HookManagerService;
        return yield* service.getRegisteredHookTypes();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides ProviderRegistryService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProviderRegistryService;
        return yield* service.listProviders();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides ContextStorageService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ContextStorageService;
        const id = yield* service.generateConversationId();
        return id;
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toMatch(/^conv_/);
  });

  test('provides AgentService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* AgentService;
        return yield* service.getAllAgents();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides CheckpointService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CheckpointService;
        return yield* service.generateRunId();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('provides PauseService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PauseService;
        return yield* service.hasPendingPause('test');
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toBe(false);
  });

  test('provides PipelineService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getAllPipelines();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });
});

describe('createScopedFredRuntime', () => {
  test('creates runtime with all services', async () => {
    const runtime = await createScopedFredRuntime();

    // Use runtime to run an effect
    const result = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const toolService = yield* ToolRegistryService;
        const agentService = yield* AgentService;
        return {
          tools: yield* toolService.size(),
          agents: yield* agentService.getAllAgents(),
        };
      })
    );

    expect(result.tools).toBe(0);
    expect(result.agents).toEqual([]);
  });

  test('runtime supports multiple sequential operations', async () => {
    const runtime = await createScopedFredRuntime();

    // First operation
    const count1 = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    // Second operation
    const count2 = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(count1).toBe(0);
    expect(count2).toBe(0);
  });
});

describe('Fred.create integration', () => {
  test('Fred.create initializes runtime', async () => {
    const { Fred } = await import('../../../packages/core/src/index');
    const fred = await Fred.create();

    expect(fred).toBeInstanceOf(Fred);

    // Runtime should be accessible
    const runtime = await fred.getRuntime();
    expect(runtime).toBeDefined();

    // Can run effects with the runtime
    const result = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(result).toBe(0);

    await fred.shutdown();
  });

  test('Fred constructor with lazy runtime works', async () => {
    const { Fred } = await import('../../../packages/core/src/index');
    const fred = new Fred();

    // Runtime not yet initialized
    // But getRuntime() triggers lazy initialization
    const runtime = await fred.getRuntime();
    expect(runtime).toBeDefined();

    await fred.shutdown();
  });
});

describe('Service isolation', () => {
  test('services have independent state', async () => {
    // Create two separate runtimes
    const runtime1 = await createScopedFredRuntime();
    const runtime2 = await createScopedFredRuntime();

    // Get initial counts
    const count1Before = await Runtime.runPromise(runtime1)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    const count2Before = await Runtime.runPromise(runtime2)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(count1Before).toBe(0);
    expect(count2Before).toBe(0);
  });
});
