import { describe, test, expect } from 'bun:test';
import { Effect } from 'effect';
import { HookManagerService, HookManagerServiceLive } from '../../../../src/core/hooks/service';
import type { HookType, HookEvent } from '../../../../src/core/hooks/types';

const runWithService = <A, E>(effect: Effect.Effect<A, E, HookManagerService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(HookManagerServiceLive)));

describe('HookManagerService', () => {
  describe('registerHook', () => {
    test('registers a hook handler', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          const handler = async () => ({ data: 'test' });
          yield* service.registerHook('beforeStep', handler);
          return yield* service.getHookCount('beforeStep');
        })
      );
      expect(result).toBe(1);
    });

    test('allows multiple handlers for same type', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('beforeStep', async () => ({}));
          return yield* service.getHookCount('beforeStep');
        })
      );
      expect(result).toBe(2);
    });
  });

  describe('executeHooks', () => {
    test('executes all handlers and collects results', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ data: 'first' }));
          yield* service.registerHook('beforeStep', async () => ({ data: 'second' }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test-pipeline' },
          };

          return yield* service.executeHooks('beforeStep', event);
        })
      );
      expect(result.length).toBe(2);
      expect(result[0].data).toBe('first');
      expect(result[1].data).toBe('second');
    });

    test('returns empty array when no handlers registered', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          const event: HookEvent = {
            type: 'afterStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };
          return yield* service.executeHooks('afterStep', event);
        })
      );
      expect(result).toEqual([]);
    });

    test('continues execution even if a handler throws', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ data: 'first' }));
          yield* service.registerHook('beforeStep', async () => {
            throw new Error('Handler error');
          });
          yield* service.registerHook('beforeStep', async () => ({ data: 'third' }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };

          return yield* service.executeHooks('beforeStep', event);
        })
      );
      // Should have results from first and third handler, skipping the errored one
      expect(result.length).toBe(2);
      expect(result[0].data).toBe('first');
      expect(result[1].data).toBe('third');
    });
  });

  describe('executeHooksAndMerge', () => {
    test('merges context from multiple handlers', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ context: { a: 1 } }));
          yield* service.registerHook('beforeStep', async () => ({ context: { b: 2 } }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };
          return yield* service.executeHooksAndMerge('beforeStep', event);
        })
      );
      expect(result.context).toEqual({ a: 1, b: 2 });
    });

    test('skip is true if any handler sets it', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ skip: true }));
          yield* service.registerHook('beforeStep', async () => ({ skip: false }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };
          return yield* service.executeHooksAndMerge('beforeStep', event);
        })
      );
      expect(result.skip).toBe(true);
    });

    test('last data wins when multiple handlers return data', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ data: 'first' }));
          yield* service.registerHook('beforeStep', async () => ({ data: 'second' }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };
          return yield* service.executeHooksAndMerge('beforeStep', event);
        })
      );
      expect(result.data).toBe('second');
    });

    test('merges metadata from multiple handlers', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({ metadata: { x: 1 } }));
          yield* service.registerHook('beforeStep', async () => ({ metadata: { y: 2 } }));

          const event: HookEvent = {
            type: 'beforeStep',
            data: { stepIndex: 0, pipelineId: 'test' },
          };
          return yield* service.executeHooksAndMerge('beforeStep', event);
        })
      );
      expect(result.metadata).toEqual({ x: 1, y: 2 });
    });
  });

  describe('unregisterHook', () => {
    test('removes a registered handler', async () => {
      const handler = async () => ({});
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', handler);
          const removed = yield* service.unregisterHook('beforeStep', handler);
          const count = yield* service.getHookCount('beforeStep');
          return { removed, count };
        })
      );
      expect(result.removed).toBe(true);
      expect(result.count).toBe(0);
    });

    test('returns false when handler not registered', async () => {
      const handler = async () => ({});
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          return yield* service.unregisterHook('beforeStep', handler);
        })
      );
      expect(result).toBe(false);
    });

    test('only removes the specific handler', async () => {
      const handler1 = async () => ({ data: '1' });
      const handler2 = async () => ({ data: '2' });
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', handler1);
          yield* service.registerHook('beforeStep', handler2);
          yield* service.unregisterHook('beforeStep', handler1);
          return yield* service.getHookCount('beforeStep');
        })
      );
      expect(result).toBe(1);
    });
  });

  describe('clearHooks', () => {
    test('removes all hooks of a specific type', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('afterStep', async () => ({}));
          yield* service.clearHooks('beforeStep');
          const beforeCount = yield* service.getHookCount('beforeStep');
          const afterCount = yield* service.getHookCount('afterStep');
          return { beforeCount, afterCount };
        })
      );
      expect(result.beforeCount).toBe(0);
      expect(result.afterCount).toBe(1);
    });
  });

  describe('clearAllHooks', () => {
    test('removes all hooks', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('afterStep', async () => ({}));
          yield* service.clearAllHooks();
          return yield* service.getRegisteredHookTypes();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('getRegisteredHookTypes', () => {
    test('returns all registered hook types', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('afterStep', async () => ({}));
          yield* service.registerHook('beforeStep', async () => ({})); // duplicate type
          return yield* service.getRegisteredHookTypes();
        })
      );
      expect(result.sort()).toEqual(['afterStep', 'beforeStep'].sort());
    });
  });

  describe('getHookCount', () => {
    test('returns count of handlers for a type', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          yield* service.registerHook('beforeStep', async () => ({}));
          yield* service.registerHook('beforeStep', async () => ({}));
          return yield* service.getHookCount('beforeStep');
        })
      );
      expect(result).toBe(2);
    });

    test('returns 0 for unregistered type', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* HookManagerService;
          return yield* service.getHookCount('beforeStep');
        })
      );
      expect(result).toBe(0);
    });
  });
});
