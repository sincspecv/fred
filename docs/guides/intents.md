# Intents

Intents define how user messages are matched and routed to specific agents or actions.

## Intent Structure

```typescript
interface Intent {
  id: string;                    // Unique identifier
  utterances: string[];          // Phrases that trigger this intent
  action: {
    type: 'agent' | 'function';  // Action type
    target: string;               // Agent ID or function name
    payload?: any;                // Optional payload
  };
  description?: string;           // Optional description
}
```

## Creating Intents

### Basic Intent

```typescript
fred.registerIntent({
  id: 'greeting',
  utterances: ['hello', 'hi', 'hey', 'greetings'],
  action: {
    type: 'agent',
    target: 'greeting-agent',
  },
});
```

### Intent with Multiple Utterances

```typescript
fred.registerIntent({
  id: 'math-question',
  utterances: [
    'calculate',
    'compute',
    'what is',
    'solve',
    'math',
    'arithmetic',
  ],
  action: {
    type: 'agent',
    target: 'math-agent',
  },
});
```

## Intent Matching

Fred uses a hybrid matching strategy:

1. **Exact Match**: Tries exact string matching first
2. **Regex Match**: Tries regex pattern matching
3. **Semantic Match**: Falls back to semantic similarity

### Exact Matching

```typescript
fred.registerIntent({
  id: 'exact-greeting',
  utterances: ['hello'],  // Only matches exactly "hello"
  action: { type: 'agent', target: 'agent' },
});
```

### Regex Matching

```typescript
fred.registerIntent({
  id: 'email-pattern',
  utterances: ['.*@.*\\..*'],  // Regex pattern for email
  action: { type: 'agent', target: 'agent' },
});
```

### Semantic Matching

Semantic matching is enabled by default and uses similarity scoring:

```typescript
const response = await fred.processMessage('Hey there!', {
  useSemanticMatching: true,
  semanticThreshold: 0.6,  // Minimum similarity score (0-1)
});
```

## Intent Actions

### Route to Agent

```typescript
fred.registerIntent({
  id: 'math',
  utterances: ['calculate'],
  action: {
    type: 'agent',
    target: 'math-agent',  // Routes to this agent
  },
});
```

### Route to Function

```typescript
fred.registerIntent({
  id: 'custom-action',
  utterances: ['custom'],
  action: {
    type: 'function',
    target: 'myFunction',
    payload: { key: 'value' },
  },
});
```

## Routing Priority

Fred routes messages in the following priority order:

1. **Agent Utterances**: Direct routing via agent-level utterances (highest priority)
2. **Intent Matching**: Match against registered intents
3. **Default Agent**: Fallback to default agent if no match found

Note: Agent-level utterances take priority over intent matching. If an agent defines utterances, messages matching those utterances will route directly to that agent, bypassing intent matching.

## Intent Priority

Intents are matched in registration order. More specific intents should be registered first:

```typescript
// Register specific intents first
fred.registerIntent({
  id: 'specific-math',
  utterances: ['calculate the square root'],
  action: { type: 'agent', target: 'math-agent' },
});

// Then general intents
fred.registerIntent({
  id: 'general-math',
  utterances: ['math', 'calculate'],
  action: { type: 'agent', target: 'math-agent' },
});
```

## Best Practices

1. **Specific First**: Register specific intents before general ones
2. **Multiple Utterances**: Include variations of phrases users might say
3. **Semantic Matching**: Use semantic matching for better user experience
4. **Default Agent**: Always have a default agent for unmatched messages
5. **Clear Intent IDs**: Use descriptive IDs for easier debugging

## Examples

### Customer Support Intents

```typescript
fred.registerIntent({
  id: 'support-refund',
  utterances: ['refund', 'return money', 'get my money back'],
  action: { type: 'agent', target: 'support-agent' },
});

fred.registerIntent({
  id: 'support-technical',
  utterances: ['technical issue', 'bug', 'not working', 'error'],
  action: { type: 'agent', target: 'technical-support-agent' },
});
```

### Multi-Language Support

```typescript
fred.registerIntent({
  id: 'greeting',
  utterances: [
    'hello', 'hi', 'hey',           // English
    'hola', 'buenos dias',          // Spanish
    'bonjour', 'salut',             // French
  ],
  action: { type: 'agent', target: 'greeting-agent' },
});
```

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Default Agent](default-agent.md)
- Check [API Reference](../api-reference/intents.md)

