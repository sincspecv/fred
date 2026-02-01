import { describe, it, expect, beforeEach } from 'bun:test';
import { Effect, Layer, Ref } from 'effect';
import { AgentService, AgentServiceLive } from '../../../../packages/core/src/agent/service';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../packages/core/src/platform/service';
import { AgentNotFoundError, AgentAlreadyExistsError, AgentCreationError } from '../../../../packages/core/src/agent/errors';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';

/**
 * Unit tests for AgentService
 *
 * Note: Full agent creation tests require mocking AgentFactory behavior, which is complex.
 * These tests verify the service interface and error handling.
 * Integration tests would verify full agent creation with real providers.
 */
describe('AgentService', () => {
  // Create test runtime with all dependencies
  const TestLayer = AgentServiceLive.pipe(
    Layer.provide(ToolRegistryServiceLive),
    Layer.provide(ProviderRegistryServiceLive)
  );

  const runTest = <A, E>(effect: Effect.Effect<A, E, AgentService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

  describe('hasAgent', () => {
    it('should return false for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.hasAgent('non-existent');
        })
      );

      expect(result).toBe(false);
    });
  });

  describe('getAgent', () => {
    it('should fail with AgentNotFoundError for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAgent('non-existent').pipe(
            Effect.either
          );
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AgentNotFoundError);
        expect(result.left.id).toBe('non-existent');
      }
    });
  });

  describe('getAgentOptional', () => {
    it('should return undefined for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAgentOptional('non-existent');
        })
      );

      expect(result).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return empty array initially', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAllAgents();
        })
      );

      expect(result).toEqual([]);
    });
  });

  describe('setTracer', () => {
    it('should set tracer without error', async () => {
      const mockTracer = {
        startSpan: () => ({ end: () => {}, setStatus: () => {}, recordException: () => {}, setAttribute: () => {} }),
      } as any;

      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setTracer(mockTracer);
        })
      );

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('setDefaultSystemMessage', () => {
    it('should set default system message without error', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setDefaultSystemMessage('Test system message');
        })
      );

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('setGlobalVariablesResolver', () => {
    it('should set global variables resolver without error', async () => {
      const resolver = () => ({ foo: 'bar', count: 42 });

      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setGlobalVariablesResolver(resolver);
        })
      );

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('matchAgentByUtterance', () => {
    it('should return null when no agents registered', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.matchAgentByUtterance('hello');
        })
      );

      expect(result).toBeNull();
    });
  });

  describe('getMCPMetrics', () => {
    it('should return MCP metrics', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getMCPMetrics();
        })
      );

      // Should return metrics object (structure verified by AgentFactory tests)
      expect(result).toBeDefined();
    });
  });

  describe('registerShutdownHooks', () => {
    it('should register shutdown hooks without error', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.registerShutdownHooks();
        })
      );

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all agents', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.clear();
          const agents = yield* service.getAllAgents();
          return agents;
        })
      );

      // Cleared successfully (no error)
      expect(true).toBe(true);
    });
  });

  describe('removeAgent', () => {
    it('should return false for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.removeAgent('non-existent');
        })
      );

      expect(result).toBe(false);
    });
  });
});
