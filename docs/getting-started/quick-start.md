# Quick Start

Get up and running with Fred in minutes. This guide will walk you through creating your first agent and processing messages.

## Basic Setup

```typescript
import { Fred } from 'fred';

// Create a Fred instance
const fred = new Fred();

// Register a provider
await fred.useProvider('openai', { 
  apiKey: process.env.OPENAI_API_KEY 
});

// Create an agent (systemMessage can be a string or file path)
await fred.createAgent({
  id: 'assistant',
  systemMessage: 'You are a helpful assistant.', // or './prompts/assistant.md'
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

// Set as default agent (handles all messages)
fred.setDefaultAgent('assistant');

// Process a message
const response = await fred.processMessage('Hello!');
console.log(response.content);
```

## With Intent Routing

```typescript
import { Fred } from 'fred';

const fred = new Fred();
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });

// Create multiple agents
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math expert.', // or './prompts/math-agent.md'
  utterances: ['calculate', 'math', 'compute'], // Optional: direct routing
  platform: 'openai',
  model: 'gpt-4',
});

await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

// Set default agent
fred.setDefaultAgent('default-agent');

// Register intent for math questions
fred.registerIntent({
  id: 'math-question',
  utterances: ['calculate', 'compute', 'what is', 'solve'],
  action: {
    type: 'agent',
    target: 'math-agent',
  },
});

// Process messages
const mathResponse = await fred.processMessage('What is 15 + 27?');
// Routes to math-agent

const generalResponse = await fred.processMessage('Tell me a joke');
// Routes to default-agent
```

## With Tools

```typescript
import { Fred } from 'fred';

const fred = new Fred();
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });

// Register a tool
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['operation', 'a', 'b'],
  },
  execute: async (args) => {
    const { operation, a, b } = args;
    switch (operation) {
      case 'add': return a + b;
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return a / b;
    }
  },
  strict: false, // Optional: Enable strict validation (AI SDK v6)
});

// Create agent with tool
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant. Use the calculator tool.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
});

fred.setDefaultAgent('math-agent');

// Agent can now use the calculator tool
const response = await fred.processMessage('What is 123 * 456?');
```

## With Context

```typescript
import { Fred } from 'fred';

const fred = new Fred();
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });

await fred.createAgent({
  id: 'assistant',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('assistant');

// Use conversation ID to maintain context
const conversationId = 'my-conversation';

const response1 = await fred.processMessage('My name is Alice', { conversationId });
const response2 = await fred.processMessage('What is my name?', { conversationId });
// Agent remembers: "Your name is Alice"
```

## Using the Embedded CLI

Projects created with `create-fred` include a built-in CLI for managing your project:

```bash
# Add a new provider
fred provider add groq

# Create a new agent
fred agent create

# Create a new tool
fred tool create

# List installed providers
fred provider list
```

See the [CLI Guide](../guides/cli.md) for complete documentation.

## Next Steps

- Learn about [Agents](../guides/agents.md)
- Explore [Intents](../guides/intents.md)
- Use the [Embedded CLI](../guides/cli.md) to manage your project
- Check out [Examples](../examples/basic-usage.md)

