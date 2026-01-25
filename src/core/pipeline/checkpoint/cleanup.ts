/**
 * Background cleanup task for expired checkpoints.
 *
 * Runs periodically to delete checkpoints that have passed their TTL,
 * keeping the storage clean without manual intervention.
 */

import type { CheckpointStorage } from './types';

/**
 * Options for checkpoint cleanup task.
 */
export interface CheckpointCleanupOptions {
  /** Interval between cleanup runs in milliseconds. Default: 1 hour */
  intervalMs?: number;
}

/**
 * Background task for TTL-based checkpoint cleanup.
 *
 * Usage:
 * ```typescript
 * const cleanup = new CheckpointCleanupTask(storage);
 * cleanup.start(); // Begins periodic cleanup
 * cleanup.stop();  // Stops cleanup (call on shutdown)
 * ```
 */
export class CheckpointCleanupTask {
  private storage: CheckpointStorage;
  private intervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  /** Default cleanup interval: 1 hour in milliseconds */
  static readonly DEFAULT_INTERVAL_MS = 3600000;

  constructor(storage: CheckpointStorage, options?: CheckpointCleanupOptions) {
    this.storage = storage;
    this.intervalMs = options?.intervalMs ?? CheckpointCleanupTask.DEFAULT_INTERVAL_MS;
  }

  /**
   * Start the periodic cleanup task.
   * Safe to call multiple times (no-op if already running).
   */
  start(): void {
    if (this.running) {
      console.warn('[Checkpoint Cleanup] Task already running');
      return;
    }

    this.running = true;
    this.timer = setInterval(async () => {
      await this.runCleanup();
    }, this.intervalMs);

    console.log(`[Checkpoint Cleanup] Started with interval ${this.intervalMs}ms`);
  }

  /**
   * Stop the periodic cleanup task.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    console.log('[Checkpoint Cleanup] Stopped');
  }

  /**
   * Run cleanup once (can be called manually or scheduled).
   * Returns number of deleted checkpoints.
   */
  async runOnce(): Promise<number> {
    return this.runCleanup();
  }

  /**
   * Check if the task is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private async runCleanup(): Promise<number> {
    try {
      const deleted = await this.storage.deleteExpired();
      if (deleted > 0) {
        console.log(`[Checkpoint Cleanup] Deleted ${deleted} expired checkpoints`);
      }
      return deleted;
    } catch (err) {
      console.error('[Checkpoint Cleanup] Error during cleanup:', err);
      return 0;
    }
  }
}
