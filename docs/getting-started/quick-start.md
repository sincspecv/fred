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

## With Built-in Tools

The easiest way to add tools is using Fred's built-in tools:

```typescript
import { Fred } from 'fred';
import { createCalculatorTool } from 'fred';

const fred = new Fred();
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });

// Register the built-in calculator tool
fred.registerTool(createCalculatorTool());

// Create agent with tool
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant. Use the calculator for mathematical operations.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
});

fred.setDefaultAgent('math-agent');

// Agent can now use the calculator tool
const response = await fred.processMessage('What is (123 + 456) * 2?');
// Agent calls calculator with expression "(123 + 456) * 2"
// Response: "The result is 1158."
```

See the [Tools Guide](../guides/tools.md) to learn about creating custom tools.

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

