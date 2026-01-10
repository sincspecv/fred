# Configuration

Fred supports both programmatic configuration and config files (JSON/YAML). This guide covers both approaches.

## Programmatic Configuration

Configure Fred directly in your code:

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// Register providers
await fred.useProvider('openai', { apiKey: 'your-key' });
await fred.useProvider('groq', { apiKey: 'your-key' });

// Register tools
fred.registerTool({ /* tool definition */ });

// Create agents
await fred.createAgent({ /* agent config */ });

// Register intents
fred.registerIntent({ /* intent definition */ });
```

## Config File Configuration

Use JSON or YAML files for configuration:

### JSON Config

Create `config.json`:

```json
{
  "intents": [
    {
      "id": "greeting",
      "utterances": ["hello", "hi", "hey"],
      "action": {
        "type": "agent",
        "target": "greeting-agent"
      }
    }
  ],
  "agents": [
    {
      "id": "greeting-agent",
      "systemMessage": "You are a friendly assistant.",
      "platform": "openai",
      "model": "gpt-3.5-turbo"
    }
  ],
  "tools": [
    {
      "id": "calculator",
      "name": "calculator",
      "description": "Perform arithmetic",
      "parameters": {
        "type": "object",
        "properties": {
          "operation": { "type": "string" },
          "a": { "type": "number" },
          "b": { "type": "number" }
        },
        "required": ["operation", "a", "b"]
      }
    }
  ]
}
```

### YAML Config

Create `config.yaml`:

```yaml
intents:
  - id: greeting
    utterances:
      - hello
      - hi
      - hey
    action:
      type: agent
      target: greeting-agent

agents:
  - id: greeting-agent
    systemMessage: ./prompts/greeting-agent.md  # File path or string
    utterances:  # Optional: direct routing (takes priority over intents)
      - hello
      - hi
      - hey
    platform: openai
    model: gpt-3.5-turbo

tools:
  - id: calculator
    name: calculator
    description: Perform arithmetic
    parameters:
      type: object
      properties:
        operation:
          type: string
        a:
          type: number
        b:
          type: number
      required:
        - operation
        - a
        - b
```

### Loading Config

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// Provide tool executors (tools need execute functions)
const toolExecutors = new Map();
toolExecutors.set('calculator', async (args) => {
  // Implementation
});

await fred.initializeFromConfig('config.json', {
  toolExecutors,
});
```

## Config File Locations

Fred looks for config files in this order:

1. `config.json`
2. `fred.config.json`
3. `config.yaml`
4. `fred.config.yaml`

Or specify a custom path:

```typescript
await fred.initializeFromConfig('./my-config.json');
```

## Environment Variables

Set API keys via environment variables:

```bash
export OPENAI_API_KEY=your_key
export GROQ_API_KEY=your_key
```

Or in provider config:

```typescript
await fred.useProvider('openai', { 
  apiKey: process.env.OPENAI_API_KEY 
});
```

## Default Agent Configuration

Set a default agent to handle unmatched messages:

```typescript
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('default-agent');
```

## Next Steps

- Learn about [Agents](guides/agents.md)
- Explore [Intents](guides/intents.md)
- Check [API Reference](../api-reference/fred-class.md)

