/**
 * SQLite-backed ContextStorage adapter using bun:sqlite.
 *
 * Provides local file-based persistence with transaction support,
 * foreign key constraints, and WAL mode for performance.
 */

import { Database } from 'bun:sqlite';
import type { ContextStorage, ConversationContext } from '../context';
import { SQLITE_SCHEMA_DDL } from './schema';
import {
  serializeMessage,
  deserializeMessage,
  serializeMetadata,
  deserializeMetadata,
} from './serialization';

/**
 * Configuration options for SqliteContextStorage.
 */
export interface SqliteContextStorageOptions {
  /**
   * Path to the SQLite database file.
   * Use ':memory:' for in-memory database (useful for tests).
   * @default 'fred.db'
   */
  path?: string;
}

/**
 * Row type for the conversations table.
 */
interface ConversationRow {
  id: string;
  created_at: string;
  updated_at: string;
  metadata: string;
}

/**
 * Row type for the messages table.
 */
interface MessageRow {
  conversation_id: string;
  sequence: number;
  payload: string;
  created_at: string;
}

/**
 * SQLite-backed implementation of ContextStorage.
 *
 * Features:
 * - File-based or in-memory persistence
 * - Transaction support for atomic operations
 * - Foreign key constraints with cascade deletes
 * - WAL mode for better concurrent read performance
 */
export class SqliteContextStorage implements ContextStorage {
  private db: Database;
  private initialized = false;

  constructor(options: SqliteContextStorageOptions = {}) {
    const path = options.path ?? 'fred.db';
    this.db = new Database(path);
  }

  /**
   * Ensure the database schema is initialized.
   * Enables foreign keys and WAL mode, then creates tables if needed.
   */
  private ensureInitialized(): void {
    if (this.initialized) return;

    // Enable foreign key constraints
    this.db.exec('PRAGMA foreign_keys = ON');

    // Enable WAL mode for better concurrent read performance
    this.db.exec('PRAGMA journal_mode = WAL');

    // Execute schema DDL (CREATE TABLE IF NOT EXISTS handles idempotency)
    this.db.exec(SQLITE_SCHEMA_DDL);

    this.initialized = true;
  }

  /**
   * Retrieve a conversation context by ID.
   * Returns null if the conversation doesn't exist.
   * Logs warnings on parse failures and returns best-effort context.
   */
  async get(id: string): Promise<ConversationContext | null> {
    this.ensureInitialized();

    // Load conversation row
    const conversationStmt = this.db.prepare(
      'SELECT id, created_at, updated_at, metadata FROM conversations WHERE id = ?'
    );
    const conversationRow = conversationStmt.get(id) as ConversationRow | null;

    if (!conversationRow) {
      return null;
    }

    // Load messages ordered by sequence
    const messagesStmt = this.db.prepare(
      'SELECT conversation_id, sequence, payload, created_at FROM messages WHERE conversation_id = ? ORDER BY sequence ASC'
    );
    const messageRows = messagesStmt.all(id) as MessageRow[];

    // Deserialize messages with best-effort error handling
    const messages = [];
    for (const row of messageRows) {
      try {
        messages.push(deserializeMessage(row.payload));
      } catch (err) {
        console.warn(
          `[SqliteContextStorage] Failed to deserialize message at sequence ${row.sequence} for conversation ${id}:`,
          err
        );
        // Skip malformed messages but continue with others
      }
    }

    // Deserialize metadata
    let metadata;
    try {
      metadata = deserializeMetadata(
        conversationRow.created_at,
        conversationRow.updated_at,
        conversationRow.metadata
      );
    } catch (err) {
      console.warn(
        `[SqliteContextStorage] Failed to deserialize metadata for conversation ${id}:`,
        err
      );
      // Return minimal metadata on failure
      metadata = {
        createdAt: new Date(conversationRow.created_at),
        updatedAt: new Date(conversationRow.updated_at),
      };
    }

    return {
      id: conversationRow.id,
      messages,
      metadata,
    };
  }

  /**
   * Store or update a conversation context.
   * Runs in a transaction: upsert conversation, delete old messages, insert new messages.
   */
  async set(id: string, context: ConversationContext): Promise<void> {
    this.ensureInitialized();

    const serializedMetadata = serializeMetadata(context.metadata);

    // Prepare statements
    const upsertConversationStmt = this.db.prepare(`
      INSERT INTO conversations (id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        metadata = excluded.metadata
    `);

    const deleteMessagesStmt = this.db.prepare(
      'DELETE FROM messages WHERE conversation_id = ?'
    );

    const insertMessageStmt = this.db.prepare(`
      INSERT INTO messages (conversation_id, sequence, payload, created_at)
      VALUES (?, ?, ?, ?)
    `);

    // Run as transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Upsert conversation row
      upsertConversationStmt.run(
        id,
        serializedMetadata.createdAt,
        serializedMetadata.updatedAt,
        serializedMetadata.metadata
      );

      // Delete existing messages
      deleteMessagesStmt.run(id);

      // Insert messages with sequence numbers
      const now = new Date().toISOString();
      for (let i = 0; i < context.messages.length; i++) {
        const serialized = serializeMessage(context.messages[i]);
        insertMessageStmt.run(id, i, serialized.payload, now);
      }
    });

    transaction();
  }

  /**
   * Delete a conversation and all its messages.
   * Messages are deleted via foreign key cascade, but we explicitly
   * delete them first for databases that might not have FK enabled.
   */
  async delete(id: string): Promise<void> {
    this.ensureInitialized();

    const deleteMessagesStmt = this.db.prepare(
      'DELETE FROM messages WHERE conversation_id = ?'
    );
    const deleteConversationStmt = this.db.prepare(
      'DELETE FROM conversations WHERE id = ?'
    );

    const transaction = this.db.transaction(() => {
      deleteMessagesStmt.run(id);
      deleteConversationStmt.run(id);
    });

    transaction();
  }

  /**
   * Clear all conversations and messages.
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM messages');
      this.db.exec('DELETE FROM conversations');
    });

    transaction();
  }

  /**
   * Close the database connection.
   * Should be called when the storage is no longer needed.
   */
  close(): void {
    this.db.close();
  }
}
