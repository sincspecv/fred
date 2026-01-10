# Basic Usage Example

A simple example showing how to get started with Fred.

## Complete Example

```typescript
import { Fred } from 'fred';

async function main() {
  // Create Fred instance
  const fred = new Fred();

  // Register a provider
  await fred.useProvider('openai', {
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Register a tool
  fred.registerTool({
    id: 'calculator',
    name: 'calculator',
    description: 'Perform basic arithmetic operations',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: ['add', 'subtract', 'multiply', 'divide'],
        },
        a: {
          type: 'number',
          description: 'First number',
        },
        b: {
          type: 'number',
          description: 'Second number',
        },
      },
      required: ['operation', 'a', 'b'],
    },
    execute: async (args) => {
      const { operation, a, b } = args;
      switch (operation) {
        case 'add':
          return a + b;
        case 'subtract':
          return a - b;
        case 'multiply':
          return a * b;
        case 'divide':
          if (b === 0) throw new Error('Division by zero');
          return a / b;
      }
    },
  });

  // Create an agent
  await fred.createAgent({
    id: 'math-assistant',
    systemMessage: 'You are a helpful math assistant. Use the calculator tool when needed.',
    platform: 'openai',
    model: 'gpt-4',
    tools: ['calculator'],
  });

  // Set as default agent
  fred.setDefaultAgent('math-assistant');

  // Register an intent
  fred.registerIntent({
    id: 'math-question',
    utterances: ['calculate', 'compute', 'what is', 'solve'],
    action: {
      type: 'agent',
      target: 'math-assistant',
    },
  });

  // Process messages
  console.log('Processing: "What is 15 + 27?"');
  const response1 = await fred.processMessage('What is 15 + 27?');
  console.log('Response:', response1?.content);

  console.log('\nProcessing: "Tell me a joke"');
  const response2 = await fred.processMessage('Tell me a joke');
  console.log('Response:', response2?.content);
}

main().catch(console.error);
```

## Running the Example

```bash
# Set API key
export OPENAI_API_KEY=your_key

# Run the example
bun run examples/basic/index.ts
```

## Expected Output

```
Processing: "What is 15 + 27?"
Response: The result of 15 + 27 is 42.

Processing: "Tell me a joke"
Response: Why don't scientists trust atoms? Because they make up everything!
```

## Key Concepts

1. **Provider**: Register an AI provider (OpenAI, Groq, etc.)
2. **Tool**: Create reusable tools for agents
3. **Agent**: Define agents with system messages and tools
4. **Default Agent**: Set a fallback for unmatched messages
5. **Intent**: Route specific messages to specific agents
6. **Process Message**: Send messages and get responses

## Next Steps

- Try the [Default Agent Example](default-agent.md)
- Explore [Chat Tool Integration](chat-tool-integration.md)
- Learn about [MCP Server Integration](mcp-server-integration.md)
- Check [Server Mode](server-mode.md)

