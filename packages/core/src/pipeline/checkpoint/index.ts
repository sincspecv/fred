/**
 * Checkpoint storage for pipeline state persistence.
 *
 * Provides adapters for persisting pipeline execution state at step boundaries,
 * enabling resume from interrupted runs.
 */

export * from './types';
export * from './schema';
export { PostgresCheckpointStorage } from './postgres';
export type { PostgresCheckpointStorageOptions } from './postgres';
export { SqliteCheckpointStorage } from './sqlite';
export type { SqliteCheckpointStorageOptions } from './sqlite';
export { CheckpointManager } from './manager';
export type { CheckpointManagerOptions, SaveCheckpointOptions } from './manager';
export { CheckpointCleanupTask } from './cleanup';
export type { CheckpointCleanupOptions } from './cleanup';
