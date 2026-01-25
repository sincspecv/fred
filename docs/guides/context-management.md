# Context Management

Fred maintains conversation context across all agents, making multi-agent conversations seamless. Users see one continuous conversation even when messages are routed to different agents.

## How Context Works

### Global Context

Context is shared across all agents in a conversation:

```typescript
const conversationId = 'my-conversation';

// First message
const response1 = await fred.processMessage('My name is Alice', { 
  conversationId 
});

// Second message - context is maintained
const response2 = await fred.processMessage('What is my name?', { 
  conversationId 
});
// Agent remembers: "Your name is Alice"
```

### Multi-Agent Context

Context persists even when routing to different agents:

```typescript
const conversationId = 'conv-123';

// Message routed to math-agent
await fred.processMessage('Calculate 5 + 3', { conversationId });

// Message routed to default-agent
await fred.processMessage('What was the previous calculation?', { conversationId });
// Default agent can see the previous math conversation
```

## Conversation IDs

### Auto-Generated IDs

If you don't provide a conversation ID, Fred generates one:

```typescript
const response = await fred.processMessage('Hello!');
// Conversation ID is auto-generated and maintained
```

### Custom Conversation IDs

Use custom IDs for better control:

```typescript
const conversationId = `user-${userId}-session-${sessionId}`;

await fred.processMessage('Hello!', { conversationId });
await fred.processMessage('How are you?', { conversationId });
```

### Getting Conversation ID

```typescript
const contextManager = fred.getContextManager();
const conversationId = contextManager.generateConversationId();
```

## Context Manager API

### Get Conversation History

```typescript
const contextManager = fred.getContextManager();
const history = await contextManager.getHistory(conversationId);

console.log(history); // Array of CoreMessage objects
```

### Clear Context

```typescript
const contextManager = fred.getContextManager();
await contextManager.clearContext(conversationId);
```

### Update Metadata

```typescript
const contextManager = fred.getContextManager();
await contextManager.updateMetadata(conversationId, {
  userId: 'user123',
  sessionStart: new Date(),
});
```

## Message Format

Fred uses AI SDK's `CoreMessage` format internally:

```typescript
interface CoreMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{ type: string; text: string }>;
}
```

## Context in Chat API

The chat API automatically manages context:

```typescript
// POST /v1/chat/completions
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "conversation_id": "my-conversation"  // Optional
}
```

Context is maintained across all requests with the same `conversation_id`.

## Best Practices

### Session Management

```typescript
// Generate conversation ID per user session
function getConversationId(userId: string): string {
  return `user-${userId}-${Date.now()}`;
}

const conversationId = getConversationId('user123');
```

### Context Cleanup

```typescript
// Clear old conversations
async function cleanupOldConversations(maxAge: number) {
  const contextManager = fred.getContextManager();
  // Implementation depends on storage backend
}
```

### Context Limits

For very long conversations, consider:

1. **Summarization**: Periodically summarize old messages
2. **Truncation**: Keep only recent N messages
3. **Pagination**: Load context in chunks

## Storage

By default, context is stored in-memory. For production, Fred provides built-in SQL adapters.

### Built-in SQL Adapters

Fred includes two production-ready persistence adapters:

**PostgreSQL** - For production deployments:
```yaml
# fred.config.yaml
persistence:
  adapter: postgres
```

Requires the `FRED_POSTGRES_URL` environment variable:
```bash
export FRED_POSTGRES_URL="postgres://user:pass@host:5432/database"
```

**SQLite** - For local development or embedded use:
```yaml
# fred.config.yaml
persistence:
  adapter: sqlite
```

Optionally set `FRED_SQLITE_PATH` (defaults to `./fred.db`):
```bash
export FRED_SQLITE_PATH="/path/to/my.db"
```

### Environment Variables

| Variable | Adapter | Required | Default |
|----------|---------|----------|---------|
| `FRED_POSTGRES_URL` | postgres | Yes | (none - throws if missing) |
| `FRED_SQLITE_PATH` | sqlite | No | `./fred.db` |

### Agent Opt-Out

By default, all agents persist conversation history. To disable persistence for a specific agent:

```yaml
# fred.config.yaml
agents:
  - id: ephemeral-agent
    provider: anthropic
    model: claude-sonnet-4-20250514
    persistHistory: false  # Conversations won't be saved
```

Or in code:
```typescript
const agent = new Agent({
  id: 'ephemeral-agent',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  persistHistory: false,
});
```

When `persistHistory` is `false`, the agent still receives conversation context during the session, but messages are not written to storage.

### Custom Storage

For other databases, implement the `ContextStorage` interface:

```typescript
import { ContextStorage, ConversationContext } from 'fred';

class CustomStorage implements ContextStorage {
  async get(id: string): Promise<ConversationContext | null> {
    // Load from your database
  }

  async set(id: string, context: ConversationContext): Promise<void> {
    // Save to your database
  }

  async delete(id: string): Promise<void> {
    // Delete from your database
  }

  async clear(): Promise<void> {
    // Clear all from your database
  }
}

const storage = new CustomStorage();
fred.getContextManager().setStorage(storage);
```

## Examples

### Chat Application

```typescript
// Web chat application
app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  
  const response = await fred.processMessage(message, {
    conversationId: conversationId || fred.getContextManager().generateConversationId(),
  });
  
  res.json({ response, conversationId });
});
```

### Multi-User System

```typescript
// Different conversation per user
const userConversations = new Map();

function getConversationId(userId: string): string {
  if (!userConversations.has(userId)) {
    const contextManager = fred.getContextManager();
    userConversations.set(userId, contextManager.generateConversationId());
  }
  return userConversations.get(userId);
}
```

## Next Steps

- Learn about [Chat API](chat-api.md)
- Explore [Default Agent](default-agent.md)
- Check [API Reference](../api-reference/context.md)

