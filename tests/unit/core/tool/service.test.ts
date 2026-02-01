import { describe, test, expect } from 'bun:test';
import { Effect } from 'effect';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import { ToolNotFoundError, ToolAlreadyExistsError } from '../../../../packages/core/src/tool/errors';
import type { Tool } from '../../../../packages/core/src/tool/tool';

const createTestTool = (id: string): Tool => ({
  id,
  name: `Test Tool ${id}`,
  description: `A test tool with id ${id}`,
  execute: async (args) => `Executed ${id} with ${JSON.stringify(args)}`
});

const runWithService = <A, E>(effect: Effect.Effect<A, E, ToolRegistryService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ToolRegistryServiceLive)));

describe('ToolRegistryService', () => {
  describe('registerTool', () => {
    test('registers a tool successfully', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          return yield* service.hasTool('test-1');
        })
      );
      expect(result).toBe(true);
    });

    test('fails when tool already exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-1'));
        }).pipe(Effect.provide(ToolRegistryServiceLive))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('registerTools', () => {
    test('registers multiple tools at once', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTools([
            createTestTool('test-1'),
            createTestTool('test-2'),
            createTestTool('test-3')
          ]);
          const size = yield* service.size();
          return size;
        })
      );
      expect(result).toBe(3);
    });
  });

  describe('getTool', () => {
    test('returns tool when exists', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          return yield* service.getTool('test-1');
        })
      );
      expect(result.id).toBe('test-1');
      expect(result.name).toBe('Test Tool test-1');
    });

    test('fails with ToolNotFoundError when not exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          return yield* service.getTool('nonexistent');
        }).pipe(Effect.provide(ToolRegistryServiceLive))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('getTools', () => {
    test('returns only found tools', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-2'));
          return yield* service.getTools(['test-1', 'test-2', 'nonexistent']);
        })
      );
      expect(result.length).toBe(2);
      expect(result.map(t => t.id)).toEqual(['test-1', 'test-2']);
    });
  });

  describe('getMissingToolIds', () => {
    test('returns IDs of tools that are not registered', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          return yield* service.getMissingToolIds(['test-1', 'test-2', 'test-3']);
        })
      );
      expect(result).toEqual(['test-2', 'test-3']);
    });
  });

  describe('getAllTools', () => {
    test('returns all registered tools', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-2'));
          return yield* service.getAllTools();
        })
      );
      expect(result.length).toBe(2);
      expect(result.map(t => t.id).sort()).toEqual(['test-1', 'test-2']);
    });

    test('returns empty array when no tools registered', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          return yield* service.getAllTools();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('hasTool', () => {
    test('returns true when tool exists', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          return yield* service.hasTool('test-1');
        })
      );
      expect(result).toBe(true);
    });

    test('returns false when tool does not exist', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          return yield* service.hasTool('nonexistent');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('removeTool', () => {
    test('removes existing tool', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          const removed = yield* service.removeTool('test-1');
          const exists = yield* service.hasTool('test-1');
          return { removed, exists };
        })
      );
      expect(result.removed).toBe(true);
      expect(result.exists).toBe(false);
    });

    test('returns false when removing non-existent tool', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          return yield* service.removeTool('nonexistent');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    test('removes all tools', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-2'));
          yield* service.clear();
          return yield* service.size();
        })
      );
      expect(result).toBe(0);
    });
  });

  describe('size', () => {
    test('returns correct number of registered tools', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          const size0 = yield* service.size();
          yield* service.registerTool(createTestTool('test-1'));
          const size1 = yield* service.size();
          yield* service.registerTool(createTestTool('test-2'));
          const size2 = yield* service.size();
          return { size0, size1, size2 };
        })
      );
      expect(result.size0).toBe(0);
      expect(result.size1).toBe(1);
      expect(result.size2).toBe(2);
    });
  });

  describe('normalizeTools', () => {
    test('returns normalized tools for registered IDs', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-2'));
          return yield* service.normalizeTools(['test-1', 'test-2']);
        })
      );
      expect(result.length).toBe(2);
      expect(result.every(t => typeof t.execute === 'function')).toBe(true);
    });
  });

  describe('toAISDKTools', () => {
    test('returns tools as Record with tool IDs as keys', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ToolRegistryService;
          yield* service.registerTool(createTestTool('test-1'));
          yield* service.registerTool(createTestTool('test-2'));
          return yield* service.toAISDKTools(['test-1', 'test-2']);
        })
      );
      expect(Object.keys(result)).toEqual(['test-1', 'test-2']);
      expect(result['test-1'].id).toBe('test-1');
      expect(result['test-2'].id).toBe('test-2');
    });
  });
});
