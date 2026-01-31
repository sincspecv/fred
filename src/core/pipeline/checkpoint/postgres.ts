/**
 * Postgres-backed CheckpointStorage adapter.
 *
 * Provides production-grade persistence using Postgres with safe transactions
 * and best-effort recovery for corrupted rows.
 */

import { Effect } from 'effect';
import type { Pool } from 'pg';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './types';
import type { PipelineContext } from '../context';
import type { PauseMetadata } from '../pause/types';
import { POSTGRES_CHECKPOINTS_DDL } from './schema';
import { withFredSpan } from '../../observability/otel';

/**
 * Fire-and-forget tracing helper.
 * Casts Effect to remove requirements channel for fire-and-forget observability.
 */
function trace(effect: Effect.Effect<void, unknown, unknown>): void {
  Effect.runFork(effect as Effect.Effect<void, never, never>);
}

/**
 * Configuration options for PostgresCheckpointStorage.
 */
export interface PostgresCheckpointStorageOptions {
  /**
   * Connection string for Postgres (e.g., postgres://user:pass@host:5432/db).
   * Either connectionString or pool must be provided.
   */
  connectionString?: string;

  /**
   * Pre-configured Pool instance for dependency injection (useful for testing).
   * Either connectionString or pool must be provided.
   */
  pool?: Pool;
}

/**
 * Serialize PipelineContext to JSON string for storage.
 */
function serializeContext(context: PipelineContext): string {
  return JSON.stringify(context);
}

/**
 * Deserialize PipelineContext from storage.
 * Accepts either a JSON string or parsed object (Postgres JSONB returns parsed).
 */
function deserializeContext(input: string | object): PipelineContext {
  if (typeof input === 'string') {
    return JSON.parse(input) as PipelineContext;
  }
  return input as PipelineContext;
}

/**
 * Serialize PauseMetadata to JSON string for storage.
 */
function serializePauseMetadata(metadata: PauseMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * Deserialize PauseMetadata from storage.
 * Accepts either a JSON string or parsed object (Postgres JSONB returns parsed).
 */
function deserializePauseMetadata(input: string | object): PauseMetadata {
  if (typeof input === 'string') {
    return JSON.parse(input) as PauseMetadata;
  }
  return input as PauseMetadata;
}

/**
 * Postgres-backed implementation of CheckpointStorage.
 *
 * Features:
 * - Lazy schema initialization with CREATE TABLE IF NOT EXISTS
 * - Transactional writes for data integrity
 * - Best-effort recovery with warnings for corrupted rows
 * - Support for both connection string and injected pool (for testing)
 */
export class PostgresCheckpointStorage implements CheckpointStorage {
  private pool: Pool;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: PostgresCheckpointStorageOptions) {
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString) {
      // Dynamic import to avoid hard dependency when pool is injected
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Pool: PgPool } = require('pg');
      this.pool = new PgPool({ connectionString: options.connectionString });
    } else {
      throw new Error(
        'PostgresCheckpointStorage requires either connectionString or pool'
      );
    }
  }

  /**
   * Lazily initialize the database schema.
   * Safe to call multiple times; only executes once.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Use promise deduplication to prevent concurrent init
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }

    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(POSTGRES_CHECKPOINTS_DDL);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Save a checkpoint (upsert by run_id + step).
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    await this.ensureInitialized();

    // Fire-and-forget span annotation
    trace(
      withFredSpan('checkpoint.storage.postgres.save', {
        runId: checkpoint.runId,
        workflowId: checkpoint.pipelineId,
        stepName: checkpoint.stepName,
        'checkpoint.step': checkpoint.step,
        'checkpoint.status': checkpoint.status,
        'storage.type': 'postgres',
      })(Effect.void)
    );

    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO checkpoints (run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (run_id, step) DO UPDATE SET
           status = EXCLUDED.status,
           context = EXCLUDED.context,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           step_name = EXCLUDED.step_name,
           pause_metadata = EXCLUDED.pause_metadata`,
        [
          checkpoint.runId,
          checkpoint.pipelineId,
          checkpoint.step,
          checkpoint.status,
          serializeContext(checkpoint.context),
          checkpoint.createdAt,
          checkpoint.updatedAt,
          checkpoint.expiresAt ?? null,
          checkpoint.stepName ?? null,
          checkpoint.pauseMetadata ? serializePauseMetadata(checkpoint.pauseMetadata) : null,
        ]
      );
    } catch (error) {
      trace(
        withFredSpan('checkpoint.storage.postgres.save.error', {
          runId: checkpoint.runId,
          workflowId: checkpoint.pipelineId,
          'error.message': error instanceof Error ? error.message : String(error),
          'storage.type': 'postgres',
        })(Effect.void)
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get the latest checkpoint for a run (highest step number).
   * Returns null if no checkpoints exist for the run.
   * Uses best-effort recovery, logging warnings for corrupted rows.
   */
  async getLatest(runId: string): Promise<Checkpoint | null> {
    await this.ensureInitialized();

    // Fire-and-forget span annotation
    trace(
      withFredSpan('checkpoint.storage.postgres.get_latest', {
        runId,
        'storage.type': 'postgres',
      })(Effect.void)
    );

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
         FROM checkpoints
         WHERE run_id = $1
         ORDER BY step DESC
         LIMIT 1`,
        [runId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      try {
        return this.rowToCheckpoint(row);
      } catch (err) {
        console.warn(
          `[PostgresCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${runId} step ${row.step}:`,
          err instanceof Error ? err.message : String(err)
        );

        trace(
          withFredSpan('checkpoint.storage.postgres.get_latest.deserialize_error', {
            runId,
            'checkpoint.step': row.step,
            'error.message': err instanceof Error ? err.message : String(err),
            'storage.type': 'postgres',
          })(Effect.void)
        );

        return null;
      }
    } catch (error) {
      trace(
        withFredSpan('checkpoint.storage.postgres.get_latest.error', {
          runId,
          'error.message': error instanceof Error ? error.message : String(error),
          'storage.type': 'postgres',
        })(Effect.void)
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a specific checkpoint by run_id and step.
   * Returns null if not found.
   */
  async get(runId: string, step: number): Promise<Checkpoint | null> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
         FROM checkpoints
         WHERE run_id = $1 AND step = $2`,
        [runId, step]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      try {
        return this.rowToCheckpoint(row);
      } catch (err) {
        console.warn(
          `[PostgresCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${runId} step ${step}:`,
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Update the status of a checkpoint.
   */
  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE checkpoints
         SET status = $3, updated_at = NOW()
         WHERE run_id = $1 AND step = $2`,
        [runId, step, status]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Delete all checkpoints for a run.
   */
  async deleteRun(runId: string): Promise<void> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM checkpoints WHERE run_id = $1', [runId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete expired checkpoints (where expires_at < NOW()).
   * @returns The number of deleted checkpoints
   */
  async deleteExpired(): Promise<number> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM checkpoints WHERE expires_at < NOW()`
      );
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  /**
   * List checkpoints by status (for querying pending pauses).
   * Excludes expired checkpoints (where expires_at < NOW()).
   */
  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata
         FROM checkpoints
         WHERE status = $1 AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC`,
        [status]
      );

      const checkpoints: Checkpoint[] = [];
      for (const row of result.rows) {
        try {
          checkpoints.push(this.rowToCheckpoint(row));
        } catch (err) {
          console.warn(
            `[PostgresCheckpointStorage] Warning: Failed to deserialize checkpoint for run ${row.run_id} step ${row.step}:`,
            err instanceof Error ? err.message : String(err)
          );
          // Skip corrupted row and continue
        }
      }

      return checkpoints;
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Convert a database row to a Checkpoint object.
   */
  private rowToCheckpoint(row: Record<string, unknown>): Checkpoint {
    return {
      runId: row.run_id as string,
      pipelineId: row.pipeline_id as string,
      step: row.step as number,
      status: row.status as CheckpointStatus,
      context: deserializeContext(row.context as string | object),
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
      expiresAt: row.expires_at ? new Date(row.expires_at as string | Date) : undefined,
      stepName: row.step_name ? (row.step_name as string) : undefined,
      pauseMetadata: row.pause_metadata
        ? deserializePauseMetadata(row.pause_metadata as string | object)
        : undefined,
    };
  }
}
