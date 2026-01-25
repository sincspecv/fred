# Context API

API reference for conversation context management.

## ContextManager

Manages conversation contexts and message history.

### Methods

#### generateConversationId()

Generate a unique conversation ID.

```typescript
const conversationId = contextManager.generateConversationId();
```

#### getContext()

Get or create a conversation context.

```typescript
const context = await contextManager.getContext(conversationId?: string): Promise<ConversationContext>
```

#### getContextById()

Get conversation context by ID.

```typescript
const context = await contextManager.getContextById(conversationId: string): Promise<ConversationContext | null>
```

#### addMessage()

Add a message to the conversation context.

```typescript
await contextManager.addMessage(conversationId: string, message: CoreMessage): Promise<void>
```

#### addMessages()

Add multiple messages to the conversation context.

```typescript
await contextManager.addMessages(conversationId: string, messages: CoreMessage[]): Promise<void>
```

#### getHistory()

Get conversation history.

```typescript
const history = await contextManager.getHistory(conversationId: string): Promise<CoreMessage[]>
```

#### updateMetadata()

Update conversation metadata.

```typescript
await contextManager.updateMetadata(
  conversationId: string,
  metadata: Partial<ConversationMetadata>
): Promise<void>
```

#### clearContext()

Clear conversation context.

```typescript
await contextManager.clearContext(conversationId: string): Promise<void>
```

#### clearAll()

Clear all conversation contexts.

```typescript
await contextManager.clearAll(): Promise<void>
```

#### setStorage()

Set custom storage implementation.

```typescript
contextManager.setStorage(storage: ContextStorage): void
```

## ConversationContext

```typescript
interface ConversationContext {
  id: string;
  messages: CoreMessage[];
  metadata: ConversationMetadata;
}
```

## ConversationMetadata

```typescript
interface ConversationMetadata {
  createdAt: Date;
  updatedAt: Date;
  [key: string]: any;
}
```

## ContextStorage

Interface for storage implementations.

```typescript
interface ContextStorage {
  get(id: string): Promise<ConversationContext | null>;
  set(id: string, context: ConversationContext): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
```

## Built-in Storage Adapters

### SqliteContextStorage

File-based persistence using Bun's built-in SQLite driver.

```typescript
import { SqliteContextStorage } from 'fred';

const storage = new SqliteContextStorage({
  path: '/path/to/fred.db',  // Optional, defaults to 'fred.db'
});

fred.getContextManager().setStorage(storage);

// Close when done
storage.close();
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `'fred.db'` | Path to SQLite database file. Use `':memory:'` for in-memory. |

**Features:**
- WAL mode for concurrent read performance
- Foreign key constraints with cascade deletes
- Transaction support for atomic writes
- Best-effort recovery for corrupted rows

### PostgresContextStorage

Production-grade persistence using PostgreSQL.

```typescript
import { PostgresContextStorage } from 'fred';

// Using connection string
const storage = new PostgresContextStorage({
  connectionString: 'postgres://user:pass@host:5432/database',
});

// Or with injected pool (for testing/advanced use)
import { Pool } from 'pg';
const pool = new Pool({ connectionString: '...' });
const storage = new PostgresContextStorage({ pool });

fred.getContextManager().setStorage(storage);

// Close when shutting down
await storage.close();
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `connectionString` | `string` | Postgres connection URL |
| `pool` | `Pool` | Pre-configured pg Pool instance (alternative to connectionString) |

One of `connectionString` or `pool` must be provided.

**Features:**
- Lazy schema initialization (tables created on first use)
- Transactional writes for data integrity
- Best-effort recovery with warnings for corrupted rows
- Automatic schema migration with `CREATE TABLE IF NOT EXISTS`

## Examples

### Getting Context Manager

```typescript
const contextManager = fred.getContextManager();
```

### Managing Conversation

```typescript
const conversationId = contextManager.generateConversationId();

// Add messages
await contextManager.addMessage(conversationId, {
  role: 'user',
  content: 'Hello!',
});

// Get history
const history = await contextManager.getHistory(conversationId);

// Update metadata
await contextManager.updateMetadata(conversationId, {
  userId: 'user123',
});

// Clear context
await contextManager.clearContext(conversationId);
```

### Custom Storage

```typescript
import { ContextStorage, ConversationContext } from 'fred';

class DatabaseStorage implements ContextStorage {
  async get(id: string): Promise<ConversationContext | null> {
    // Load from database
  }
  
  async set(id: string, context: ConversationContext): Promise<void> {
    // Save to database
  }
  
  async delete(id: string): Promise<void> {
    // Delete from database
  }
  
  async clear(): Promise<void> {
    // Clear all from database
  }
}

const storage = new DatabaseStorage();
const contextManager = fred.getContextManager();
contextManager.setStorage(storage);
```

