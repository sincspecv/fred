# Chat Tool Integration Example

Example showing how to use Fred with AI chat tools like Misty, Chatbox, etc., including built-in and custom tools.

## Complete Example with Built-in Tools

```typescript
import { Fred } from 'fred';
import { createCalculatorTool } from 'fred';
import { ServerApp } from 'fred/server';

async function main() {
  const fred = new Fred();

  // Register providers
  fred.registerDefaultProviders();

  // Register built-in calculator tool
  fred.registerTool(createCalculatorTool());

  // Create a default agent with calculator
  await fred.createAgent({
    id: 'default-agent',
    systemMessage: 'You are a helpful assistant with calculator capabilities.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
    tools: ['calculator'], // Assign built-in calculator
  });
  fred.setDefaultAgent('default-agent');

  // Create specialized math agent
  await fred.createAgent({
    id: 'math-agent',
    systemMessage: 'You are a math expert. Use the calculator for all mathematical operations.',
    platform: 'openai',
    model: 'gpt-4',
    tools: ['calculator'], // Math agent also gets calculator
  });

  // Register intents
  fred.registerIntent({
    id: 'math',
    utterances: ['calculate', 'math', 'solve'],
    action: { type: 'agent', target: 'math-agent' },
  });

  // Start server
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server running on http://localhost:3000');
  console.log('OpenAI-compatible endpoint: POST /v1/chat/completions');
  console.log('Try: "What is (100 + 50) * 2?"');
}
```

## Example with Custom and Built-in Tools

```typescript
import { Fred } from 'fred';
import { createCalculatorTool } from 'fred';
import { ServerApp } from 'fred/server';

async function main() {
  const fred = new Fred();
  fred.registerDefaultProviders();

  // Register built-in calculator
  fred.registerTool(createCalculatorTool());

  // Register a custom weather tool
  fred.registerTool({
    id: 'weather',
    name: 'weather',
    description: 'Get weather information for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
    execute: async (args) => {
      // Simulated weather data
      return `Weather in ${args.location}: 72°F, partly cloudy`;
    },
  });

  // Create agent with both tools
  await fred.createAgent({
    id: 'assistant',
    systemMessage: 'You are a helpful assistant with calculator and weather capabilities.',
    platform: 'openai',
    model: 'gpt-4',
    tools: ['calculator', 'weather'], // Both built-in and custom tools
  });
  fred.setDefaultAgent('assistant');

  // Start server
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server running on http://localhost:3000');
  console.log('Try: "What is 15 * 20 in Boston today?"');
}
```

## Basic Example

```typescript
import { Fred } from 'fred';
import { ServerApp } from 'fred/server';

async function main() {
  const fred = new Fred();

  // Register providers
  fred.registerDefaultProviders();

  // Create a default agent
  await fred.createAgent({
    id: 'default-agent',
    systemMessage: 'You are a helpful assistant.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });
  fred.setDefaultAgent('default-agent');

  // Create specialized agents
  await fred.createAgent({
    id: 'math-agent',
    systemMessage: 'You are a math expert.',
    platform: 'openai',
    model: 'gpt-4',
  });

  // Register intents
  fred.registerIntent({
    id: 'math',
    utterances: ['calculate', 'math', 'solve'],
    action: { type: 'agent', target: 'math-agent' },
  });

  // Start server
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server running on http://localhost:3000');
  console.log('OpenAI-compatible endpoint: POST /v1/chat/completions');
}
```

## Using with Chat Tools

### Misty

Configure Misty to use:
- API Endpoint: `http://localhost:3000/v1/chat/completions`
- Model: `fred-agent`

### Chatbox

In Chatbox settings:
- Custom API: `http://localhost:3000/v1/chat/completions`
- Model: `fred-agent`

### curl Example

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

