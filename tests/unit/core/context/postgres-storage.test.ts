/**
 * Unit tests for PostgresContextStorage using mocked Pool/Client.
 *
 * These tests verify query sequencing and parameter handling without
 * requiring an actual Postgres database connection.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { PostgresContextStorage } from '../../../../packages/core/src/context/storage/postgres';
import type { ConversationContext } from '../../../../packages/core/src/context/context';

// -----------------------------------------------------------------------------
// Mock Client Factory
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
      if (text.includes('SELECT') && text.includes('conversations')) {
        return queryResults.conversation ?? { rows: [] };
      }
      if (text.includes('SELECT') && text.includes('messages')) {
        return queryResults.messages ?? { rows: [] };
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
// Test Suite
// -----------------------------------------------------------------------------

describe('PostgresContextStorage', () => {
  describe('constructor', () => {
    it('throws when neither connectionString nor pool provided', () => {
      expect(() => new PostgresContextStorage({})).toThrow(
        'PostgresContextStorage requires either connectionString or pool'
      );
    });

    it('accepts pool for dependency injection', () => {
      const { client } = createMockClient({});
      const pool = createMockPool(client);

      const storage = new PostgresContextStorage({ pool: pool as any });
      expect(storage).toBeInstanceOf(PostgresContextStorage);
    });
  });

  describe('get()', () => {
    it('returns null when conversation does not exist', async () => {
      const { client, queries } = createMockClient({
        conversation: { rows: [] },
      });
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      const result = await storage.get('non-existent-id');

      expect(result).toBeNull();
      // Should have initialized schema and queried conversations
      expect(queries.some((q) => q.text.includes('CREATE TABLE'))).toBe(true);
      expect(
        queries.some(
          (q) =>
            q.text.includes('SELECT') &&
            q.text.includes('conversations') &&
            q.values?.[0] === 'non-existent-id'
        )
      ).toBe(true);
    });

    it('reconstructs messages in order from rows', async () => {
      const now = new Date();
      const { client, queries } = createMockClient({
        conversation: {
          rows: [
            {
              id: 'thread-1',
              created_at: now,
              updated_at: now,
              metadata: {},
            },
          ],
        },
        messages: {
          rows: [
            { payload: { _tag: 'UserMessage', parts: [{ _tag: 'Text', content: 'Hello' }] } },
            { payload: { _tag: 'AssistantMessage', parts: [{ _tag: 'Text', content: 'Hi there!' }] } },
          ],
        },
      });
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      const result = await storage.get('thread-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('thread-1');
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0]._tag).toBe('UserMessage');
      expect(result!.messages[1]._tag).toBe('AssistantMessage');
      expect(result!.metadata.createdAt).toBeInstanceOf(Date);
      expect(result!.metadata.updatedAt).toBeInstanceOf(Date);

      // Verify message query used ORDER BY sequence
      expect(
        queries.some(
          (q) =>
            q.text.includes('SELECT') &&
            q.text.includes('messages') &&
            q.text.includes('ORDER BY sequence')
        )
      ).toBe(true);
    });

    it('handles corrupted message rows with best-effort recovery', async () => {
      const now = new Date();
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0]));
      };

      try {
        const { client } = createMockClient({
          conversation: {
            rows: [
              {
                id: 'thread-1',
                created_at: now,
                updated_at: now,
                metadata: {},
              },
            ],
          },
          messages: {
            rows: [
              { payload: { _tag: 'UserMessage', parts: [{ _tag: 'Text', content: 'Valid' }] } },
              { payload: 'not valid json structure for message' },
              { payload: { _tag: 'AssistantMessage', parts: [{ _tag: 'Text', content: 'Also valid' }] } },
            ],
          },
        });
        const pool = createMockPool(client);
        const storage = new PostgresContextStorage({ pool: pool as any });

        const result = await storage.get('thread-1');

        // Should recover valid messages, skip corrupted
        expect(result).not.toBeNull();
        expect(result!.messages.length).toBeGreaterThanOrEqual(2);
        expect(warnings.some((w) => w.includes('Warning'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('set()', () => {
    it('runs transaction with BEGIN, upsert, delete, inserts, COMMIT', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      const context: ConversationContext = {
        id: 'thread-1',
        messages: [
          { _tag: 'UserMessage', parts: [{ _tag: 'Text', content: 'Hello' }] } as any,
          { _tag: 'AssistantMessage', parts: [{ _tag: 'Text', content: 'Hi!' }] } as any,
        ],
        metadata: {
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        },
      };

      await storage.set('thread-1', context);

      // Find query sequence after schema init
      const txQueries = queries.filter(
        (q) => !q.text.includes('CREATE') && !q.text.includes('INDEX')
      );

      // Verify transaction flow
      expect(txQueries[0].text).toBe('BEGIN');

      // Upsert conversation
      const upsertQuery = txQueries.find(
        (q) => q.text.includes('INSERT INTO conversations')
      );
      expect(upsertQuery).toBeDefined();
      expect(upsertQuery!.text).toContain('ON CONFLICT (id) DO UPDATE');
      expect(upsertQuery!.values?.[0]).toBe('thread-1');

      // Delete existing messages
      const deleteQuery = txQueries.find(
        (q) => q.text.includes('DELETE FROM messages')
      );
      expect(deleteQuery).toBeDefined();
      expect(deleteQuery!.values?.[0]).toBe('thread-1');

      // Insert new messages
      const insertQueries = txQueries.filter(
        (q) => q.text.includes('INSERT INTO messages')
      );
      expect(insertQueries).toHaveLength(2);
      expect(insertQueries[0].values?.[1]).toBe(0); // sequence 0
      expect(insertQueries[1].values?.[1]).toBe(1); // sequence 1

      // Commit
      expect(txQueries[txQueries.length - 1].text).toBe('COMMIT');
    });

    it('rolls back on error', async () => {
      const { client, queries } = createMockClient({});
      // Make the delete query throw
      client.query = mock(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes('DELETE FROM messages')) {
          throw new Error('Simulated error');
        }
        return { rows: [], rowCount: 0 };
      });
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      const context: ConversationContext = {
        id: 'thread-1',
        messages: [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      await expect(storage.set('thread-1', context)).rejects.toThrow(
        'Simulated error'
      );

      // Should have rolled back
      expect(queries.some((q) => q.text === 'ROLLBACK')).toBe(true);
    });
  });

  describe('delete()', () => {
    it('issues DELETE query in transaction', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      await storage.delete('thread-to-delete');

      const txQueries = queries.filter(
        (q) => !q.text.includes('CREATE') && !q.text.includes('INDEX')
      );

      expect(txQueries[0].text).toBe('BEGIN');

      const deleteQuery = txQueries.find(
        (q) => q.text.includes('DELETE FROM conversations')
      );
      expect(deleteQuery).toBeDefined();
      expect(deleteQuery!.values?.[0]).toBe('thread-to-delete');

      expect(txQueries[txQueries.length - 1].text).toBe('COMMIT');
    });
  });

  describe('clear()', () => {
    it('deletes all conversations in transaction', async () => {
      const { client, queries } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      await storage.clear();

      const txQueries = queries.filter(
        (q) => !q.text.includes('CREATE') && !q.text.includes('INDEX')
      );

      expect(txQueries[0].text).toBe('BEGIN');

      const deleteQuery = txQueries.find(
        (q) => q.text.includes('DELETE FROM conversations')
      );
      expect(deleteQuery).toBeDefined();
      // No values for clear - deletes all
      expect(deleteQuery!.values).toBeUndefined();

      expect(txQueries[txQueries.length - 1].text).toBe('COMMIT');
    });
  });

  describe('schema initialization', () => {
    it('only initializes schema once across multiple operations', async () => {
      const { client, queries } = createMockClient({
        conversation: { rows: [] },
      });
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      // Multiple operations
      await storage.get('id-1');
      await storage.get('id-2');
      await storage.delete('id-3');

      // Count CREATE TABLE queries
      const createQueries = queries.filter((q) =>
        q.text.includes('CREATE TABLE')
      );
      expect(createQueries).toHaveLength(1);
    });
  });

  describe('close()', () => {
    it('calls pool.end()', async () => {
      const { client } = createMockClient({});
      const pool = createMockPool(client);
      const storage = new PostgresContextStorage({ pool: pool as any });

      await storage.close();

      expect(pool.end).toHaveBeenCalled();
    });
  });
});
