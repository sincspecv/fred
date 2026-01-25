import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { CheckpointCleanupTask } from '../../../../../src/core/pipeline/checkpoint/cleanup';
import type { CheckpointStorage } from '../../../../../src/core/pipeline/checkpoint/types';

describe('CheckpointCleanupTask', () => {
  let mockStorage: CheckpointStorage;
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let logMessages: string[];
  let warnMessages: string[];
  let errorMessages: Array<{ message: string; error?: Error }>;

  beforeEach(() => {
    logMessages = [];
    warnMessages = [];
    errorMessages = [];

    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    console.log = (...args: any[]) => {
      logMessages.push(args.join(' '));
    };
    console.warn = (...args: any[]) => {
      warnMessages.push(args.join(' '));
    };
    console.error = (...args: any[]) => {
      errorMessages.push({ message: args[0], error: args[1] });
    };

    mockStorage = {
      save: mock(() => Promise.resolve()),
      getLatest: mock(() => Promise.resolve(null)),
      get: mock(() => Promise.resolve(null)),
      updateStatus: mock(() => Promise.resolve()),
      deleteRun: mock(() => Promise.resolve()),
      deleteExpired: mock(() => Promise.resolve(0)),
      close: mock(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('constructor', () => {
    test('uses default interval when not specified', () => {
      const task = new CheckpointCleanupTask(mockStorage);
      expect(task).toBeDefined();
      // Default is 1 hour (3600000ms)
      task.start();
      expect(logMessages.some(m => m.includes('3600000ms'))).toBe(true);
      task.stop();
    });

    test('uses custom interval when specified', () => {
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 60000 });
      task.start();
      expect(logMessages.some(m => m.includes('60000ms'))).toBe(true);
      task.stop();
    });
  });

  describe('start()', () => {
    test('sets running state to true', () => {
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 1000 });

      task.start();
      expect(task.isRunning()).toBe(true);
      expect(logMessages.some(m => m.includes('Started with interval 1000ms'))).toBe(true);
      task.stop();
    });

    test('logs warning when already running', () => {
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 1000 });

      task.start();
      task.start(); // Second call should warn

      expect(warnMessages.some(m => m.includes('Task already running'))).toBe(true);
      task.stop();
    });
  });

  describe('stop()', () => {
    test('sets running state to false', () => {
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 1000 });

      task.start();
      expect(task.isRunning()).toBe(true);

      task.stop();
      expect(task.isRunning()).toBe(false);
      expect(logMessages.some(m => m.includes('Stopped'))).toBe(true);
    });

    test('can be called multiple times safely', () => {
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 1000 });

      task.start();
      task.stop();
      task.stop(); // Should not throw

      expect(task.isRunning()).toBe(false);
    });
  });

  describe('runOnce()', () => {
    test('returns deleted count from storage', async () => {
      (mockStorage.deleteExpired as any).mockImplementation(() => Promise.resolve(5));

      const task = new CheckpointCleanupTask(mockStorage);
      const deleted = await task.runOnce();

      expect(deleted).toBe(5);
      expect(mockStorage.deleteExpired).toHaveBeenCalledTimes(1);
    });

    test('works without starting periodic task', async () => {
      (mockStorage.deleteExpired as any).mockImplementation(() => Promise.resolve(3));

      const task = new CheckpointCleanupTask(mockStorage);
      expect(task.isRunning()).toBe(false);

      const deleted = await task.runOnce();
      expect(deleted).toBe(3);
      expect(task.isRunning()).toBe(false);
    });

    test('logs deleted count when > 0', async () => {
      (mockStorage.deleteExpired as any).mockImplementation(() => Promise.resolve(10));

      const task = new CheckpointCleanupTask(mockStorage);
      await task.runOnce();

      expect(logMessages.some(m => m.includes('Deleted 10 expired checkpoints'))).toBe(true);
    });

    test('does not log when deleted count is 0', async () => {
      (mockStorage.deleteExpired as any).mockImplementation(() => Promise.resolve(0));

      const task = new CheckpointCleanupTask(mockStorage);
      // Clear log messages from construction
      logMessages = [];

      await task.runOnce();

      expect(logMessages.some(m => m.includes('Deleted'))).toBe(false);
    });
  });

  describe('isRunning()', () => {
    test('returns false before start', () => {
      const task = new CheckpointCleanupTask(mockStorage);
      expect(task.isRunning()).toBe(false);
    });

    test('returns true after start', () => {
      const task = new CheckpointCleanupTask(mockStorage);
      task.start();
      expect(task.isRunning()).toBe(true);
      task.stop();
    });

    test('returns false after stop', () => {
      const task = new CheckpointCleanupTask(mockStorage);
      task.start();
      task.stop();
      expect(task.isRunning()).toBe(false);
    });
  });

  describe('error handling', () => {
    test('catches and logs errors from storage', async () => {
      const error = new Error('Database connection failed');
      (mockStorage.deleteExpired as any).mockImplementation(() => Promise.reject(error));

      const task = new CheckpointCleanupTask(mockStorage);
      const deleted = await task.runOnce();

      expect(deleted).toBe(0);
      expect(errorMessages.some(e =>
        e.message.includes('Error during cleanup') && e.error === error
      )).toBe(true);
    });

    test('returns 0 when error occurs', async () => {
      (mockStorage.deleteExpired as any).mockImplementation(() =>
        Promise.reject(new Error('fail'))
      );

      const task = new CheckpointCleanupTask(mockStorage);
      const deleted = await task.runOnce();

      expect(deleted).toBe(0);
    });
  });

  describe('periodic cleanup', () => {
    test('periodic execution triggers deleteExpired', async () => {
      // Use a very short interval for testing
      const task = new CheckpointCleanupTask(mockStorage, { intervalMs: 10 });

      task.start();

      // Wait for a tick to happen
      await new Promise(resolve => setTimeout(resolve, 50));

      task.stop();

      // Should have been called at least once
      expect((mockStorage.deleteExpired as any).mock.calls.length).toBeGreaterThan(0);
    });
  });
});
