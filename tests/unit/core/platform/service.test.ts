import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../src/core/platform/service';
import { ProviderNotFoundError } from '../../../../src/core/platform/errors';
import type { ProviderDefinition, ProviderConfig } from '../../../../src/core/platform/provider';

// Mock provider definition for testing
const createMockDefinition = (id: string, aliases: string[] = []): ProviderDefinition => ({
  id,
  aliases,
  config: {
    modelDefaults: { model: 'test-model' }
  },
  getModel: (modelId, options) => Effect.succeed({} as any),
  layer: Layer.empty,
});

const runWithService = <A, E>(effect: Effect.Effect<A, E, ProviderRegistryService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ProviderRegistryServiceLive)));

describe('ProviderRegistryService', () => {
  describe('registerDefinition', () => {
    test('registers a provider definition', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(createMockDefinition('openai', ['gpt']));
          return yield* service.hasProvider('openai');
        })
      );
      expect(result).toBe(true);
    });

    test('registers aliases', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(createMockDefinition('openai', ['gpt']));
          const hasMain = yield* service.hasProvider('openai');
          const hasAlias = yield* service.hasProvider('gpt');
          return { hasMain, hasAlias };
        })
      );
      expect(result.hasMain).toBe(true);
      expect(result.hasAlias).toBe(true);
    });
  });

  describe('getDefinition', () => {
    test('returns definition when exists', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(createMockDefinition('openai'));
          return yield* service.getDefinition('openai');
        })
      );
      expect(result.id).toBe('openai');
    });

    test('fails with ProviderNotFoundError when not exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          return yield* service.getDefinition('nonexistent');
        }).pipe(Effect.provide(ProviderRegistryServiceLive))
      );
      expect(result._tag).toBe('Failure');
    });

    test('lookup is case-insensitive', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(createMockDefinition('OpenAI'));
          return yield* service.getDefinition('openai');
        })
      );
      expect(result.id).toBe('OpenAI');
    });
  });

  describe('listProviders', () => {
    test('returns unique provider IDs', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(createMockDefinition('openai', ['gpt']));
          yield* service.registerDefinition(createMockDefinition('anthropic'));
          return yield* service.listProviders();
        })
      );
      expect(result.sort()).toEqual(['anthropic', 'openai']);
    });
  });

  describe('initialization', () => {
    test('tracks initialization status', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          const before = yield* service.isInitialized();
          yield* service.markInitialized();
          const after = yield* service.isInitialized();
          return { before, after };
        })
      );
      expect(result.before).toBe(false);
      expect(result.after).toBe(true);
    });
  });

  describe('getModel', () => {
    test('returns model from provider', async () => {
      const mockDef = createMockDefinition('openai');
      mockDef.getModel = () => Effect.succeed({ model: 'test' } as any);

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          yield* service.registerDefinition(mockDef);
          return yield* service.getModel('openai', 'gpt-4');
        })
      );
      expect(result).toBeDefined();
    });

    test('fails when provider not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* ProviderRegistryService;
          return yield* service.getModel('nonexistent', 'model');
        }).pipe(Effect.provide(ProviderRegistryServiceLive))
      );
      expect(result._tag).toBe('Failure');
    });
  });
});
