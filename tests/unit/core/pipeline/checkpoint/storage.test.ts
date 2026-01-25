/**
 * Unit tests for checkpoint storage adapters.
 *
 * Tests both PostgresCheckpointStorage (with mocked Pool) and
 * SqliteCheckpointStorage (with in-memory database) to verify
 * checkpoint CRUD operations, status updates, and expiry cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PostgresCheckpointStorage } from '../../../../../src/core/pipeline/checkpoint/postgres';
import { SqliteCheckpointStorage } from '../../../../../src/core/pipeline/checkpoint/sqlite';
import type { Checkpoint, CheckpointStatus } from '../../../../../src/core/pipeline/checkpoint/types';
import type { PipelineContext } from '../../../../../src/core/pipeline/context';

// -----------------------------------------------------------------------------
// Test Data Helpers
// -----------------------------------------------------------------------------

function createTestContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    pipelineId: 'test-pipeline',
    input: 'test input',
    outputs: { step1: 'output1' },
    history: [],
    metadata: { testKey: 'testValue' },
    ...overrides,
  };
}

function createTestCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  const now = new Date();
  return {
    runId: 'run-123',
    pipelineId: 'test-pipeline',
    step: 0,
    status: 'pending',
    context: createTestContext(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Mock Pool/Client for Postgres Tests
// -----------------------------------------------------------------------------

interface QueryCall {
  text: string;
  values?: unknown[];
}

function createMockClient(queryResults: Record<string, unknown>) {
  const queries: QueryCall[] = [];

  const client = {
    query: mock(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });

      // Match query patterns to return appropriate results
      if (text.includes('SELECT') && text.includes('checkpoints')) {
        return queryResults.checkpoints ?? { rows: [] };
      }
      if (text.includes('DELETE') && text.includes('checkpoints')) {
        return queryResults.delete ?? { rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: mock(() => {}),
  };

  return { client, queries };
}

function createMockPool(client: ReturnType<typeof createMockClient>['client']) {
  return {
    connect: mock(async () => client),
    end: mock(async () => {}),
  };
}

// -----------------------------------------------------------------------------
// PostgresCheckpointStorage Tests
// -----------------------------------------------------------------------------

describe('PostgresCheckpointStorage', () => {
  describe('constructor', () => {
    it('throws when neither connectionString nor pool provided', () => {
      expect(() => new PostgresCheckpointStorage({})).toThrow(
        'PostgresCheckpointStorage requires either connectionString or pool'
      );
    });

    it('accepts pool for dependency injection', () => {
      const { client } = createMockClient({});
      const pool = createMockPool(client);

      const storage = new PostgresCheckpointStorage({ pool: pool as any });
      expect(storage).toBeInstanceOf(PostgresCheckpointStorage);
    });
  });

  describe('save()', () => {
    it('executes INSERT ... ON CONFLICT with correct values', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const checkpoint = createTestCheckpoint();
      await storage.save(checkpoint);

      // Find the INSERT query
      const insertQuery = queries.find((q) => q.text.includes('INSERT INTO checkpoints'));
      expect(insertQuery).toBeDefined();
      expect(insertQuery!.text).toContain('ON CONFLICT (run_id, step) DO UPDATE');
      expect(insertQuery!.values?.[0]).toBe('run-123'); // run_id
      expect(insertQuery!.values?.[1]).toBe('test-pipeline'); // pipeline_id
      expect(insertQuery!.values?.[2]).toBe(0); // step
      expect(insertQuery!.values?.[3]).toBe('pending'); // status
    });
  });

  describe('getLatest()', () => {
    it('returns null when no checkpoints exist', async () => {
      const { client } = createMockClient({
        checkpoints: { rows: [] },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const result = await storage.getLatest('non-existent-run');
      expect(result).toBeNull();
    });

    it('returns the checkpoint with highest step number', async () => {
      const now = new Date();
      const { client, queries } = createMockClient({
        checkpoints: {
          rows: [
            {
              run_id: 'run-123',
              pipeline_id: 'test-pipeline',
              step: 2,
              status: 'completed',
              context: { pipelineId: 'test-pipeline', input: 'test', outputs: {}, history: [], metadata: {} },
              created_at: now,
              updated_at: now,
              expires_at: null,
            },
          ],
        },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const result = await storage.getLatest('run-123');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-123');
      expect(result!.step).toBe(2);
      expect(result!.status).toBe('completed');

      // Verify ORDER BY step DESC LIMIT 1
      const selectQuery = queries.find(
        (q) => q.text.includes('SELECT') && q.text.includes('ORDER BY step DESC')
      );
      expect(selectQuery).toBeDefined();
      expect(selectQuery!.text).toContain('LIMIT 1');
    });

    it('logs warning and returns null for corrupted context', async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0]));
      };

      try {
        const { client } = createMockClient({
          checkpoints: {
            rows: [
              {
                run_id: 'run-123',
                pipeline_id: 'test-pipeline',
                step: 0,
                status: 'pending',
                context: 'not valid json', // corrupted
                created_at: new Date(),
                updated_at: new Date(),
                expires_at: null,
              },
            ],
          },
        });
        const pool = createMockPool(client);
        const storage = new PostgresCheckpointStorage({ pool: pool as any });

        const result = await storage.getLatest('run-123');

        expect(result).toBeNull();
        expect(warnings.some((w) => w.includes('Warning'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('get()', () => {
    it('returns specific checkpoint by run_id and step', async () => {
      const now = new Date();
      const { client } = createMockClient({
        checkpoints: {
          rows: [
            {
              run_id: 'run-123',
              pipeline_id: 'test-pipeline',
              step: 1,
              status: 'in_progress',
              context: { pipelineId: 'test-pipeline', input: 'test', outputs: {}, history: [], metadata: {} },
              created_at: now,
              updated_at: now,
              expires_at: null,
            },
          ],
        },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const result = await storage.get('run-123', 1);

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-123');
      expect(result!.step).toBe(1);
      expect(result!.status).toBe('in_progress');
    });

    it('returns null when checkpoint not found', async () => {
      const { client } = createMockClient({
        checkpoints: { rows: [] },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const result = await storage.get('run-123', 99);
      expect(result).toBeNull();
    });
  });

  describe('updateStatus()', () => {
    it('executes UPDATE with correct status', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      await storage.updateStatus('run-123', 1, 'completed');

      const updateQuery = queries.find((q) => q.text.includes('UPDATE checkpoints'));
      expect(updateQuery).toBeDefined();
      expect(updateQuery!.values).toContain('run-123');
      expect(updateQuery!.values).toContain(1);
      expect(updateQuery!.values).toContain('completed');
    });
  });

  describe('deleteRun()', () => {
    it('executes DELETE in transaction', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      await storage.deleteRun('run-123');

      const txQueries = queries.filter(
        (q) => !q.text.includes('CREATE') && !q.text.includes('INDEX')
      );

      expect(txQueries.some((q) => q.text === 'BEGIN')).toBe(true);
      expect(txQueries.some((q) => q.text.includes('DELETE FROM checkpoints'))).toBe(true);
      expect(txQueries.some((q) => q.text === 'COMMIT')).toBe(true);
    });
  });

  describe('deleteExpired()', () => {
    it('returns count of deleted rows', async () => {
      const { client } = createMockClient({
        delete: { rowCount: 5 },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      const count = await storage.deleteExpired();
      expect(count).toBe(5);
    });

    it('executes DELETE with expires_at < NOW()', async () => {
      const { client, queries } = createMockClient({
        delete: { rowCount: 0 },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      await storage.deleteExpired();

      const deleteQuery = queries.find(
        (q) => q.text.includes('DELETE') && q.text.includes('expires_at')
      );
      expect(deleteQuery).toBeDefined();
      expect(deleteQuery!.text).toContain('expires_at < NOW()');
    });
  });

  describe('close()', () => {
    it('calls pool.end()', async () => {
      const { client } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      await storage.close();

      expect(pool.end).toHaveBeenCalled();
    });
  });

  describe('schema initialization', () => {
    it('only initializes schema once across multiple operations', async () => {
      const { client, queries } = createMockClient({
        checkpoints: { rows: [] },
      });
      const pool = createMockPool(client);
      const storage = new PostgresCheckpointStorage({ pool: pool as any });

      // Multiple operations
      await storage.getLatest('run-1');
      await storage.getLatest('run-2');
      await storage.get('run-3', 0);

      // Count CREATE TABLE queries
      const createQueries = queries.filter((q) => q.text.includes('CREATE TABLE'));
      expect(createQueries).toHaveLength(1);
    });
  });
});

// -----------------------------------------------------------------------------
// SqliteCheckpointStorage Tests
// -----------------------------------------------------------------------------

describe('SqliteCheckpointStorage', () => {
  let storage: SqliteCheckpointStorage;

  beforeEach(() => {
    // Use in-memory database for tests
    storage = new SqliteCheckpointStorage({ path: ':memory:' });
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('save and getLatest', () => {
    it('round-trips a checkpoint', async () => {
      const checkpoint = createTestCheckpoint();

      await storage.save(checkpoint);
      const result = await storage.getLatest('run-123');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-123');
      expect(result!.pipelineId).toBe('test-pipeline');
      expect(result!.step).toBe(0);
      expect(result!.status).toBe('pending');
      expect(result!.context.input).toBe('test input');
      expect(result!.context.outputs).toEqual({ step1: 'output1' });
    });

    it('returns the latest checkpoint (highest step)', async () => {
      const checkpoint1 = createTestCheckpoint({ step: 0, status: 'completed' });
      const checkpoint2 = createTestCheckpoint({ step: 1, status: 'completed' });
      const checkpoint3 = createTestCheckpoint({ step: 2, status: 'in_progress' });

      await storage.save(checkpoint1);
      await storage.save(checkpoint2);
      await storage.save(checkpoint3);

      const result = await storage.getLatest('run-123');

      expect(result).not.toBeNull();
      expect(result!.step).toBe(2);
      expect(result!.status).toBe('in_progress');
    });

    it('returns null when no checkpoints exist', async () => {
      const result = await storage.getLatest('non-existent');
      expect(result).toBeNull();
    });

    it('updates existing checkpoint on re-save', async () => {
      const checkpoint1 = createTestCheckpoint({ status: 'pending' });
      await storage.save(checkpoint1);

      const checkpoint2 = createTestCheckpoint({ status: 'completed' });
      await storage.save(checkpoint2);

      const result = await storage.getLatest('run-123');
      expect(result!.status).toBe('completed');
    });
  });

  describe('get', () => {
    it('returns specific checkpoint by run_id and step', async () => {
      const checkpoint0 = createTestCheckpoint({ step: 0, status: 'completed' });
      const checkpoint1 = createTestCheckpoint({ step: 1, status: 'in_progress' });

      await storage.save(checkpoint0);
      await storage.save(checkpoint1);

      const result = await storage.get('run-123', 0);

      expect(result).not.toBeNull();
      expect(result!.step).toBe(0);
      expect(result!.status).toBe('completed');
    });

    it('returns null when checkpoint not found', async () => {
      const result = await storage.get('run-123', 99);
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates checkpoint status', async () => {
      const checkpoint = createTestCheckpoint({ status: 'pending' });
      await storage.save(checkpoint);

      await storage.updateStatus('run-123', 0, 'completed');

      const result = await storage.get('run-123', 0);
      expect(result!.status).toBe('completed');
    });
  });

  describe('deleteRun', () => {
    it('removes all checkpoints for a run', async () => {
      const checkpoint0 = createTestCheckpoint({ step: 0 });
      const checkpoint1 = createTestCheckpoint({ step: 1 });
      const otherCheckpoint = createTestCheckpoint({ runId: 'other-run', step: 0 });

      await storage.save(checkpoint0);
      await storage.save(checkpoint1);
      await storage.save(otherCheckpoint);

      await storage.deleteRun('run-123');

      expect(await storage.getLatest('run-123')).toBeNull();
      expect(await storage.getLatest('other-run')).not.toBeNull();
    });
  });

  describe('deleteExpired', () => {
    it('deletes checkpoints with past expires_at', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

      const expiredCheckpoint = createTestCheckpoint({
        runId: 'expired-run',
        expiresAt: pastDate,
      });
      const validCheckpoint = createTestCheckpoint({
        runId: 'valid-run',
        expiresAt: futureDate,
      });
      const noExpiryCheckpoint = createTestCheckpoint({
        runId: 'no-expiry-run',
      });

      await storage.save(expiredCheckpoint);
      await storage.save(validCheckpoint);
      await storage.save(noExpiryCheckpoint);

      const deletedCount = await storage.deleteExpired();

      expect(deletedCount).toBe(1);
      expect(await storage.getLatest('expired-run')).toBeNull();
      expect(await storage.getLatest('valid-run')).not.toBeNull();
      expect(await storage.getLatest('no-expiry-run')).not.toBeNull();
    });

    it('returns 0 when no expired checkpoints', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      const checkpoint = createTestCheckpoint({ expiresAt: futureDate });

      await storage.save(checkpoint);

      const deletedCount = await storage.deleteExpired();
      expect(deletedCount).toBe(0);
    });
  });

  describe('best-effort recovery', () => {
    it('logs warning and returns null for corrupted context', async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0]));
      };

      try {
        // Save a valid checkpoint first
        const checkpoint = createTestCheckpoint();
        await storage.save(checkpoint);

        // Manually corrupt the context in the database
        // @ts-expect-error - accessing private db for testing
        const db = storage.db;
        db.exec(`UPDATE checkpoints SET context = 'not valid json' WHERE run_id = 'run-123'`);

        const result = await storage.getLatest('run-123');

        expect(result).toBeNull();
        expect(warnings.some((w) => w.includes('Warning'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('preserves timestamps and expiresAt', () => {
    it('round-trips Date fields correctly', async () => {
      const createdAt = new Date('2026-01-10T10:00:00Z');
      const updatedAt = new Date('2026-01-10T10:30:00Z');
      const expiresAt = new Date('2026-01-17T10:00:00Z');

      const checkpoint = createTestCheckpoint({
        createdAt,
        updatedAt,
        expiresAt,
      });

      await storage.save(checkpoint);
      const result = await storage.getLatest('run-123');

      expect(result).not.toBeNull();
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe('2026-01-10T10:00:00.000Z');
      expect(result!.updatedAt.toISOString()).toBe('2026-01-10T10:30:00.000Z');
      expect(result!.expiresAt!.toISOString()).toBe('2026-01-17T10:00:00.000Z');
    });

    it('handles undefined expiresAt', async () => {
      const checkpoint = createTestCheckpoint({ expiresAt: undefined });

      await storage.save(checkpoint);
      const result = await storage.getLatest('run-123');

      expect(result).not.toBeNull();
      expect(result!.expiresAt).toBeUndefined();
    });
  });
});
