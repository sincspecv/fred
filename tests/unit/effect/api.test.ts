import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';

// Test that imports from fred/effect work
import {
  // Services
  FredLayers,
  AgentService,
  PipelineService,
  ToolRegistryService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  CheckpointService,
  PauseService,

  // Errors
  AgentNotFoundError,
  PipelineNotFoundError,
  ToolNotFoundError,
  ContextNotFoundError,
  type FredError,

  // Layers
  FredService,
  FredServiceLive,
  withCustomLayer,

  // Runtime
  createScopedFredRuntime,
} from '../../../src/effect';

describe('Effect API exports', () => {
  describe('Services', () => {
    test('exports all service tags', () => {
      expect(AgentService).toBeDefined();
      expect(PipelineService).toBeDefined();
      expect(ToolRegistryService).toBeDefined();
      expect(ContextStorageService).toBeDefined();
      expect(ProviderRegistryService).toBeDefined();
      expect(HookManagerService).toBeDefined();
      expect(CheckpointService).toBeDefined();
      expect(PauseService).toBeDefined();
    });

    test('FredLayers is a valid Layer', () => {
      expect(FredLayers).toBeDefined();
    });
  });

  describe('Errors', () => {
    test('exports tagged error constructors', () => {
      const agentError = new AgentNotFoundError({ id: 'test' });
      expect(agentError._tag).toBe('AgentNotFoundError');
      expect(agentError.id).toBe('test');

      const pipelineError = new PipelineNotFoundError({ id: 'test' });
      expect(pipelineError._tag).toBe('PipelineNotFoundError');

      const toolError = new ToolNotFoundError({ id: 'test' });
      expect(toolError._tag).toBe('ToolNotFoundError');

      const contextError = new ContextNotFoundError({ conversationId: 'test' });
      expect(contextError._tag).toBe('ContextNotFoundError');
    });
  });

  describe('Effect composition', () => {
    test('can run Effect with FredLayers', async () => {
      const program = Effect.gen(function* () {
        const toolService = yield* ToolRegistryService;
        return yield* toolService.size();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(FredLayers))
      );

      expect(result).toBe(0);
    });

    test('can catch tagged errors', async () => {
      const program = Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAgent('nonexistent');
      }).pipe(
        Effect.catchTag('AgentNotFoundError', (e) =>
          Effect.succeed({ fallback: true, id: e.id })
        )
      );

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(FredLayers))
      );

      expect(result).toEqual({ fallback: true, id: 'nonexistent' });
    });

    test('FredService provides aggregated access', async () => {
      const program = Effect.gen(function* () {
        const fred = yield* FredService;
        const agents = yield* fred.agents.getAllAgents();
        const pipelines = yield* fred.pipelines.getAllPipelines();
        return { agents: agents.length, pipelines: pipelines.length };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(FredServiceLive))
      );

      expect(result.agents).toBe(0);
      expect(result.pipelines).toBe(0);
    });
  });

  describe('Runtime creation', () => {
    test('createScopedFredRuntime works', async () => {
      const runtime = await createScopedFredRuntime();
      expect(runtime).toBeDefined();
    });
  });

  describe('Layer composition', () => {
    test('withCustomLayer creates merged layer', () => {
      // Create a mock custom layer (just verify the function works)
      const customLayer = Layer.succeed(
        { _tag: 'TestService' } as any,
        { value: 'test' }
      );
      
      const merged = withCustomLayer(customLayer);
      expect(merged).toBeDefined();
    });
  });
});
