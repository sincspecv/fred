import { describe, test, expect, beforeEach } from 'bun:test';
import { HookManager } from '../../../../src/core/hooks/manager';
import { HookType, HookEvent, HookResult } from '../../../../src/core/hooks/types';

describe('HookManager', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  function createHookEvent(type: HookType, data: any = {}): HookEvent {
    return {
      type,
      data,
    };
  }

  describe('registerHook', () => {
    test('should register a hook handler', () => {
      const handler = async () => ({});
      manager.registerHook('beforeMessageReceived', handler);

      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);
    });

    test('should register multiple handlers for same hook type', () => {
      const handler1 = async () => ({});
      const handler2 = async () => ({});
      const handler3 = async () => ({});

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      expect(manager.getHookCount('beforeMessageReceived')).toBe(3);
    });

    test('should register handlers for different hook types', () => {
      manager.registerHook('beforeMessageReceived', async () => ({}));
      manager.registerHook('afterMessageReceived', async () => ({}));
      manager.registerHook('beforeToolCalled', async () => ({}));

      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);
      expect(manager.getHookCount('afterMessageReceived')).toBe(1);
      expect(manager.getHookCount('beforeToolCalled')).toBe(1);
    });
  });

  describe('unregisterHook', () => {
    test('should unregister a hook handler', () => {
      const handler = async () => ({});
      manager.registerHook('beforeMessageReceived', handler);

      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);

      const removed = manager.unregisterHook('beforeMessageReceived', handler);
      expect(removed).toBe(true);
      expect(manager.getHookCount('beforeMessageReceived')).toBe(0);
    });

    test('should return false when unregistering non-existent handler', () => {
      const handler1 = async () => ({});
      const handler2 = async () => ({});

      manager.registerHook('beforeMessageReceived', handler1);

      const removed = manager.unregisterHook('beforeMessageReceived', handler2);
      expect(removed).toBe(false);
      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);
    });

    test('should return false when unregistering from non-existent hook type', () => {
      const handler = async () => ({});
      const removed = manager.unregisterHook('beforeMessageReceived', handler);
      expect(removed).toBe(false);
    });

    test('should only remove the specific handler', () => {
      const handler1 = async () => ({});
      const handler2 = async () => ({});

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);

      manager.unregisterHook('beforeMessageReceived', handler1);

      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);
    });
  });

  describe('executeHooks', () => {
    test('should execute single hook handler', async () => {
      let executed = false;
      const handler = async (event: HookEvent) => {
        executed = true;
        expect(event.type).toBe('beforeMessageReceived');
        return {};
      };

      manager.registerHook('beforeMessageReceived', handler);
      const results = await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(executed).toBe(true);
      expect(results).toHaveLength(1);
    });

    test('should execute multiple handlers in order', async () => {
      const executionOrder: number[] = [];

      const handler1 = async () => {
        executionOrder.push(1);
        return {};
      };
      const handler2 = async () => {
        executionOrder.push(2);
        return {};
      };
      const handler3 = async () => {
        executionOrder.push(3);
        return {};
      };

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(executionOrder).toEqual([1, 2, 3]);
    });

    test('should return empty array when no handlers registered', async () => {
      const results = await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));
      expect(results).toEqual([]);
    });

    test('should collect results from all handlers', async () => {
      const handler1 = async () => ({ context: { field1: 'value1' } });
      const handler2 = async () => ({ context: { field2: 'value2' } });
      const handler3 = async () => ({ data: 'modified data' });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      const results = await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(results).toHaveLength(3);
      expect(results[0].context?.field1).toBe('value1');
      expect(results[1].context?.field2).toBe('value2');
      expect(results[2].data).toBe('modified data');
    });

    test('should continue executing other handlers when one throws', async () => {
      const handler1 = async () => {
        throw new Error('Handler 1 error');
      };
      const handler2 = async () => ({ context: { field: 'value' } });
      const handler3 = async () => ({ data: 'data' });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      // Should not throw, but should log error
      const results = await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      // Should still execute other handlers
      expect(results).toHaveLength(2);
      expect(results[0].context?.field).toBe('value');
      expect(results[1].data).toBe('data');
    });

    test('should handle handlers that return void', async () => {
      const handler1 = async () => {};
      const handler2 = async () => ({ context: { field: 'value' } });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);

      const results = await manager.executeHooks('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(results).toHaveLength(1);
      expect(results[0].context?.field).toBe('value');
    });
  });

  describe('executeHooksAndMerge', () => {
    test('should merge context from all handlers', async () => {
      const handler1 = async () => ({ context: { field1: 'value1', shared: 'value1' } });
      const handler2 = async () => ({ context: { field2: 'value2', shared: 'value2' } });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);

      const merged = await manager.executeHooksAndMerge('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(merged.context).toEqual({
        field1: 'value1',
        field2: 'value2',
        shared: 'value2', // Last one wins
      });
    });

    test('should use last data value', async () => {
      const handler1 = async () => ({ data: 'data1' });
      const handler2 = async () => ({ data: 'data2' });
      const handler3 = async () => ({ data: 'data3' });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      const merged = await manager.executeHooksAndMerge('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(merged.data).toBe('data3');
    });

    test('should set skip to true if any handler requests it', async () => {
      const handler1 = async () => ({ skip: false });
      const handler2 = async () => ({ skip: true });
      const handler3 = async () => ({ skip: false });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);
      manager.registerHook('beforeMessageReceived', handler3);

      const merged = await manager.executeHooksAndMerge('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(merged.skip).toBe(true);
    });

    test('should merge metadata', async () => {
      const handler1 = async () => ({ metadata: { field1: 'value1' } });
      const handler2 = async () => ({ metadata: { field2: 'value2' } });

      manager.registerHook('beforeMessageReceived', handler1);
      manager.registerHook('beforeMessageReceived', handler2);

      const merged = await manager.executeHooksAndMerge('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(merged.metadata).toEqual({
        field1: 'value1',
        field2: 'value2',
      });
    });

    test('should return empty object when no handlers', async () => {
      const merged = await manager.executeHooksAndMerge('beforeMessageReceived', createHookEvent('beforeMessageReceived'));

      expect(merged).toEqual({});
    });
  });

  describe('clearHooks', () => {
    test('should clear hooks for specific type', () => {
      manager.registerHook('beforeMessageReceived', async () => ({}));
      manager.registerHook('afterMessageReceived', async () => ({}));

      manager.clearHooks('beforeMessageReceived');

      expect(manager.getHookCount('beforeMessageReceived')).toBe(0);
      expect(manager.getHookCount('afterMessageReceived')).toBe(1);
    });
  });

  describe('clearAllHooks', () => {
    test('should clear all hooks', () => {
      manager.registerHook('beforeMessageReceived', async () => ({}));
      manager.registerHook('afterMessageReceived', async () => ({}));
      manager.registerHook('beforeToolCalled', async () => ({}));

      manager.clearAllHooks();

      expect(manager.getHookCount('beforeMessageReceived')).toBe(0);
      expect(manager.getHookCount('afterMessageReceived')).toBe(0);
      expect(manager.getHookCount('beforeToolCalled')).toBe(0);
    });
  });

  describe('getRegisteredHookTypes', () => {
    test('should return all registered hook types', () => {
      manager.registerHook('beforeMessageReceived', async () => ({}));
      manager.registerHook('afterMessageReceived', async () => ({}));
      manager.registerHook('beforeToolCalled', async () => ({}));

      const types = manager.getRegisteredHookTypes();

      expect(types).toContain('beforeMessageReceived');
      expect(types).toContain('afterMessageReceived');
      expect(types).toContain('beforeToolCalled');
      expect(types).toHaveLength(3);
    });

    test('should return empty array when no hooks registered', () => {
      const types = manager.getRegisteredHookTypes();
      expect(types).toEqual([]);
    });
  });

  describe('getHookCount', () => {
    test('should return correct count for hook type', () => {
      expect(manager.getHookCount('beforeMessageReceived')).toBe(0);

      manager.registerHook('beforeMessageReceived', async () => ({}));
      expect(manager.getHookCount('beforeMessageReceived')).toBe(1);

      manager.registerHook('beforeMessageReceived', async () => ({}));
      expect(manager.getHookCount('beforeMessageReceived')).toBe(2);
    });

    test('should return 0 for non-existent hook type', () => {
      expect(manager.getHookCount('nonexistentHook' as HookType)).toBe(0);
    });
  });
});
