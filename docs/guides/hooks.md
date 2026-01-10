# Pipeline Hooks

Fred provides a comprehensive hooks system that allows you to intercept and modify the message processing pipeline at strategic points. This enables powerful features like context injection, logging, analytics, and custom processing logic.

## Overview

Hooks are functions that execute at specific points in the message processing pipeline. You can register multiple hooks for the same hook point, and they will execute in registration order.

## Available Hook Points

Fred provides 12 hook points covering the entire message processing lifecycle:

1. **beforeMessageReceived** - Before processing starts
2. **afterMessageReceived** - After message added to context
3. **beforeIntentDetermined** - Before intent matching
4. **afterIntentDetermined** - After intent match found
5. **beforeAgentSelected** - Before agent is chosen
6. **afterAgentSelected** - After agent selected
7. **beforeToolCalled** - Before tool execution
8. **afterToolCalled** - After tool execution
9. **beforeResponseGenerated** - Before AI generates response
10. **afterResponseGenerated** - After response generated
11. **beforeContextInserted** - Before context added to conversation
12. **afterContextInserted** - After context added

## Registering Hooks

```typescript
import { Fred, HookType } from 'fred';

const fred = new Fred();

// Register a hook
fred.registerHook('beforeToolCalled', async (event) => {
  console.log('Tool about to be called:', event.data);
  
  // Return context to inject
  return {
    context: {
      timestamp: Date.now(),
      toolName: event.data.toolId,
    },
  };
});
```

## Hook Event Structure

Each hook receives an event object with the following structure:

```typescript
interface HookEvent {
  type: HookType;              // The hook point type
  data: any;                   // Event-specific data
  conversationId?: string;     // Conversation ID if available
  metadata?: Record<string, any>; // Additional metadata
}
```

## Hook Result

Hooks can return a result to modify the pipeline:

```typescript
interface HookResult {
  context?: Record<string, any>;  // Context to inject
  data?: any;                     // Modified data
  skip?: boolean;                 // Skip next step
  metadata?: Record<string, any>;  // Additional metadata
}
```

## Examples

### Context Injection

Inject context at various pipeline stages:

```typescript
// Inject user preferences before agent selection
fred.registerHook('beforeAgentSelected', async (event) => {
  const userId = event.metadata?.userId;
  const preferences = await getUserPreferences(userId);
  
  return {
    context: {
      userPreferences: preferences,
    },
  };
});

// Add timestamp to tool calls
fred.registerHook('beforeToolCalled', async (event) => {
  return {
    context: {
      toolCallTimestamp: Date.now(),
    },
  };
});
```

### Logging and Analytics

Track message processing:

```typescript
// Log all messages
fred.registerHook('afterMessageReceived', async (event) => {
  console.log('Message received:', {
    conversationId: event.conversationId,
    message: event.data.message,
    timestamp: Date.now(),
  });
  
  // Send to analytics
  await analytics.track('message_received', {
    conversationId: event.conversationId,
  });
});

// Track tool usage
fred.registerHook('afterToolCalled', async (event) => {
  await analytics.track('tool_used', {
    toolId: event.data.toolId,
    conversationId: event.conversationId,
  });
});
```

### Modify Agent Selection

Intercept and modify agent selection:

```typescript
fred.registerHook('afterIntentDetermined', async (event) => {
  const intent = event.data.intent;
  
  // Override agent selection based on custom logic
  if (intent.id === 'support' && isBusinessHours()) {
    return {
      data: {
        ...event.data,
        action: {
          type: 'agent',
          target: 'support-agent-business-hours',
        },
      },
    };
  }
});
```

### Modify Tool Parameters

Adjust tool parameters before execution:

```typescript
fred.registerHook('beforeToolCalled', async (event) => {
  const toolCall = event.data;
  
  // Add additional context to tool calls
  if (toolCall.toolId === 'search') {
    return {
      data: {
        ...toolCall,
        args: {
          ...toolCall.args,
          includeMetadata: true,
          userId: event.metadata?.userId,
        },
      },
    };
  }
});
```

### Response Modification

Modify responses before they're returned:

```typescript
fred.registerHook('afterResponseGenerated', async (event) => {
  const response = event.data;
  
  // Add metadata to response
  return {
    data: {
      ...response,
      metadata: {
        processingTime: event.metadata?.processingTime,
        model: event.metadata?.model,
      },
    },
  };
});
```

## Multiple Hooks

You can register multiple hooks for the same hook point. They execute in registration order, and results are merged:

```typescript
// First hook
fred.registerHook('beforeToolCalled', async (event) => {
  return { context: { hook1: 'value1' } };
});

// Second hook
fred.registerHook('beforeToolCalled', async (event) => {
  return { context: { hook2: 'value2' } };
});

// Both contexts are merged: { hook1: 'value1', hook2: 'value2' }
```

## Unregistering Hooks

Remove a hook handler:

```typescript
const handler = async (event) => {
  // Hook logic
};

fred.registerHook('beforeToolCalled', handler);

// Later, unregister it
fred.unregisterHook('beforeToolCalled', handler);
```

## Error Handling

Hooks that throw errors don't stop the pipeline. Errors are logged, and processing continues:

```typescript
fred.registerHook('beforeToolCalled', async (event) => {
  try {
    // Your logic
  } catch (error) {
    // Error is logged automatically
    // Pipeline continues
  }
});
```

## Best Practices

1. **Keep Hooks Fast**: Hooks execute synchronously in the pipeline. Keep them fast to avoid delays.

2. **Use Async Appropriately**: Hooks can be async, but consider the impact on response time.

3. **Don't Modify Event Data Directly**: Return modified data in the result instead of mutating the event.

4. **Use Context for Additional Data**: Use the context field to pass data between hooks and the pipeline.

5. **Handle Errors Gracefully**: Errors in hooks are logged but don't stop processing.

6. **Document Your Hooks**: Document what each hook does and when it's used.

## Hook Execution Order

Hooks execute in the order they're registered. For hooks that return data, the last hook's data takes precedence when merging results.

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Intents](intents.md)
- Check [API Reference](../api-reference/fred-class.md)
