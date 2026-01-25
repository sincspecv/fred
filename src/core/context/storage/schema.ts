/**
 * SQL schema definitions for context storage adapters.
 *
 * Provides DDL strings for both Postgres and SQLite that define the
 * conversations and messages tables with proper ordering and cascade deletes.
 */

// -----------------------------------------------------------------------------
// Postgres Schema DDL
// -----------------------------------------------------------------------------

/**
 * Postgres DDL for the conversations table.
 * Uses JSONB for metadata and TIMESTAMPTZ for timestamps.
 */
export const POSTGRES_CONVERSATIONS_DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at);
`;

/**
 * Postgres DDL for the messages table.
 * Uses composite primary key on (conversation_id, sequence) for ordering.
 * Cascade deletes when parent conversation is removed.
 */
export const POSTGRES_MESSAGES_DDL = `
CREATE TABLE IF NOT EXISTS messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
`;

/**
 * Combined Postgres DDL for both tables.
 */
export const POSTGRES_SCHEMA_DDL = `
${POSTGRES_CONVERSATIONS_DDL}
${POSTGRES_MESSAGES_DDL}
`;

// -----------------------------------------------------------------------------
// SQLite Schema DDL
// -----------------------------------------------------------------------------

/**
 * SQLite DDL for the conversations table.
 * Uses TEXT for JSON storage (SQLite lacks native JSON type in DDL).
 * Timestamps stored as ISO 8601 strings.
 */
export const SQLITE_CONVERSATIONS_DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at);
`;

/**
 * SQLite DDL for the messages table.
 * Uses composite primary key on (conversation_id, sequence) for ordering.
 * Cascade deletes require PRAGMA foreign_keys = ON at runtime.
 */
export const SQLITE_MESSAGES_DDL = `
CREATE TABLE IF NOT EXISTS messages (
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, sequence),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
`;

/**
 * Combined SQLite DDL for both tables.
 */
export const SQLITE_SCHEMA_DDL = `
${SQLITE_CONVERSATIONS_DDL}
${SQLITE_MESSAGES_DDL}
`;

// -----------------------------------------------------------------------------
// Schema Initialization Helpers
// -----------------------------------------------------------------------------

/**
 * Get the appropriate schema DDL for a database type.
 */
export function getSchemaFor(dbType: 'postgres' | 'sqlite'): string {
  return dbType === 'postgres' ? POSTGRES_SCHEMA_DDL : SQLITE_SCHEMA_DDL;
}

/**
 * Get the conversations table DDL for a database type.
 */
export function getConversationsDDL(dbType: 'postgres' | 'sqlite'): string {
  return dbType === 'postgres' ? POSTGRES_CONVERSATIONS_DDL : SQLITE_CONVERSATIONS_DDL;
}

/**
 * Get the messages table DDL for a database type.
 */
export function getMessagesDDL(dbType: 'postgres' | 'sqlite'): string {
  return dbType === 'postgres' ? POSTGRES_MESSAGES_DDL : SQLITE_MESSAGES_DDL;
}
