/**
 * SQLite-backed CheckpointStorage adapter using bun:sqlite.
 *
 * Provides local file-based persistence with transaction support
 * and WAL mode for performance.
 */

import { Effect } from 'effect';
import { Database } from 'bun:sqlite';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './types';
import type { PipelineContext } from '../context';
import type { PauseMetadata } from '../pause/types';
import { SQLITE_CHECKPOINTS_DDL } from './schema';
import { withFredSpan } from '../../observability/otel';

/**
 * Fire-and-forget tracing helper.
 * Casts Effect to remove requirements channel for fire-and-forget observability.
 */
function trace(effect: Effect.Effect<void, unknown, unknown>): void {
  Effect.runFork(effect as Effect.Effect<void, never, never>);
}

/**
 * Configuration options for SqliteCheckpointStorage.
 */
export interface SqliteCheckpointStorageOptions {
  /**
   * Path to the SQLite database file.
   * Use ':memory:' for in-memory database (useful for tests).
   * @default 'fred.db'
   */
  path?: string;

  /**
   * Pre-configured Database instance for dependency injection (useful for testing).
   */
  db?: Database;
}

/**
 * Row type for the checkpoints table.
 */
interface CheckpointRow {
  run_id: string;
  pipeline_id: string;
  step: number;
  status: string;
  context: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  step_name: string | null;
  pause_metadata: string | null;
}

/**
 * Serialize PipelineContext to JSON string for storage.
 */
function serializeContext(context: PipelineContext): string {
  return JSON.stringify(context);
}

/**
 * Deserialize PipelineContext from storage.
 */
function deserializeContext(input: string): PipelineContext {
  return JSON.parse(input) as PipelineContext;
}

/**
 * Serialize PauseMetadata to JSON string for storage.
 */
function serializePauseMetadata(metadata: PauseMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * Deserialize PauseMetadata from storage.
 */
function deserializePauseMetadata(input: string): PauseMetadata {
  return JSON.parse(input) as PauseMetadata;
}

/**
 * SQLite-backed implementation of CheckpointStorage.
 *
 * Features:
 * - File-based or in-memory persistence
 * - Transaction support for atomic operations
 * - WAL mode for better concurrent read performance
 * - Best-effort recovery with warnings for corrupted rows
 */
export class SqliteCheckpointStorage implements CheckpointStorage {
  private db: Database;
  private initialized = false;

  constructor(options: SqliteCheckpointStorageOptions = {}) {
    if (options.db) {
      this.db = options.db;
    } else {
      const path = options.path ?? 'fred.db';
      this.db = new Database(path);
    }
  }

  /**
   * Ensure the database schema is initialized.
   * Enables foreign keys and WAL mode, then creates tables if needed.
   */
  private ensureInitialized(): void {
    if (this.initialized) return;

    // Enable WAL mode for better concurrent read performance
    this.db.exec('PRAGMA journal_mode = WAL');

    // Execute schema DDL (CREATE TABLE IF NOT EXISTS handles idempotency)
    this.db.exec(SQLITE_CHECKPOINTS_DDL);

    this.initialized = true;
  }

  /**
   * Save a checkpoint (upsert by run_id + step).
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    this.ensureInitialized();

    // Fire-and-forget span annotation
    trace(
      withFredSpan('checkpoint.storage.sqlite.save', {
        runId: checkpoint.runId,
        workflowId: checkpoint.pipelineId,
        stepName: checkpoint.stepName,
        'checkpoint.step': checkpoint.step,
        'checkpoint.status': checkpoint.status,
        'storage.type': 'sqlite',
      })(Effect.void)
    );

    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, step) DO UPDATE SET
        status = excluded.status,
        context = excluded.context,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        step_name = excluded.step_name,
        pause_metadata = excluded.pause_metadata
    `);

    try {
      stmt.run(
        checkpoint.runId,
        checkpoint.pipelineId,
        checkpoint.step,
        checkpoint.status,
        serializeContext(checkpoint.context),
        checkpoint.createdAt.toISOString(),
        checkpoint.updatedAt.toISOString(),
        checkpoint.expiresAt?.toISOString() ?? null,
        checkpoint.stepName ?? null,
        checkpoint.pauseMetadata ? serializePauseMetadata(checkpoint.pauseMetadata) : null
      );
    } catch (error) {
      trace(
        withFredSpan('checkpoint.storage.sqlite.save.error', {
          runId: checkpoint.runId,
          workflowId: checkpoint.pipelineId,
          'error.message': error instanceof Error ? error.message : String(error),
          'storage.type': 'sqlite',
        })(Effect.void)
      );
      throw error;
    }
  }

  /**
   * Get the latest checkpoint for a run (highest step number).
   * Returns null if no checkpoints exist for the run.
   */
  async getLatest(runId: string): Promise<Checkpoint | null> {
    this.ensureInitialized();

    // Fire-and-forget span annotation
    trace(
      withFredSpan('checkpoint.storage.sqlite.get_latest', {
        runId,
        'storage.type': 'sqlite',
      })(Effect.void)
    );

    const stmt = this.db.prepare(`
      SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
      FROM checkpoints
      WHERE run_id = ?
      ORDER BY step DESC
      LIMIT 1
    `);

    try {
      const row = stmt.get(runId) as CheckpointRow | null;

      if (!row) {
        return null;
      }

      try {
        return this.rowToCheckpoint(row);
      } catch (err) {
        console.warn(
          `[SqliteCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${runId} step ${row.step}:`,
          err instanceof Error ? err.message : String(err)
        );

        trace(
          withFredSpan('checkpoint.storage.sqlite.get_latest.deserialize_error', {
            runId,
            'checkpoint.step': row.step,
            'error.message': err instanceof Error ? err.message : String(err),
            'storage.type': 'sqlite',
          })(Effect.void)
        );

        return null;
      }
    } catch (error) {
      trace(
        withFredSpan('checkpoint.storage.sqlite.get_latest.error', {
          runId,
          'error.message': error instanceof Error ? error.message : String(error),
          'storage.type': 'sqlite',
        })(Effect.void)
      );
      throw error;
    }
  }

  /**
   * Get a specific checkpoint by run_id and step.
   * Returns null if not found.
   */
  async get(runId: string, step: number): Promise<Checkpoint | null> {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
      FROM checkpoints
      WHERE run_id = ? AND step = ?
    `);

    const row = stmt.get(runId, step) as CheckpointRow | null;

    if (!row) {
      return null;
    }

    try {
      return this.rowToCheckpoint(row);
    } catch (err) {
      console.warn(
        `[SqliteCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${runId} step ${step}:`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }

  /**
   * Update the status of a checkpoint.
   */
  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      UPDATE checkpoints
      SET status = ?, updated_at = datetime('now')
      WHERE run_id = ? AND step = ?
    `);

    stmt.run(status, runId, step);
  }

  /**
   * Delete all checkpoints for a run.
   */
  async deleteRun(runId: string): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.prepare('DELETE FROM checkpoints WHERE run_id = ?');

    const transaction = this.db.transaction(() => {
      stmt.run(runId);
    });

    transaction();
  }

  /**
   * Delete expired checkpoints (where expires_at < current time).
   * Uses ISO 8601 string comparison since expires_at is stored as ISO string.
   * @returns The number of deleted checkpoints
   */
  async deleteExpired(): Promise<number> {
    this.ensureInitialized();

    // Compare ISO 8601 strings directly (lexicographic comparison works for ISO dates)
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `DELETE FROM checkpoints WHERE expires_at IS NOT NULL AND expires_at < ?`
    );

    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * List checkpoints by status (for querying pending pauses).
   * Excludes expired checkpoints (where expires_at < current time).
   */
  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
      FROM checkpoints
      WHERE status = ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(status, now) as CheckpointRow[];

    const checkpoints: Checkpoint[] = [];
    for (const row of rows) {
      try {
        checkpoints.push(this.rowToCheckpoint(row));
      } catch (err) {
        console.warn(
          `[SqliteCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${row.run_id} step ${row.step}:`,
          err instanceof Error ? err.message : String(err)
        );
        // Skip corrupted row and continue
      }
    }

    return checkpoints;
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    this.db.close();
  }

  /**
   * Convert a database row to a Checkpoint object.
   */
  private rowToCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      runId: row.run_id,
      pipelineId: row.pipeline_id,
      step: row.step,
      status: row.status as CheckpointStatus,
      context: deserializeContext(row.context),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      stepName: row.step_name ?? undefined,
      pauseMetadata: row.pause_metadata ? deserializePauseMetadata(row.pause_metadata) : undefined,
    };
  }
}
