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
    mcpServers:  # Optional: MCP servers for this agent
      - id: filesystem
        name: File System
        transport: stdio
        command: npx
        args:
          - -y
          - @modelcontextprotocol/server-filesystem
          - /allowed/path

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

Set API keys via environment variables. Fred automatically detects available providers from environment variables.

### Complete List of API Key Environment Variables

Create a `.env` file in your project root with the API keys for the providers you want to use:

```env
# Core Providers
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key

# Fast & Cost-Effective Providers
GROQ_API_KEY=your_groq_key
MISTRAL_API_KEY=your_mistral_key
DEEPSEEK_API_KEY=your_deepseek_key

# Additional Providers
COHERE_API_KEY=your_cohere_key
FIREWORKS_API_KEY=your_fireworks_key
XAI_API_KEY=your_xai_key
PERPLEXITY_API_KEY=your_perplexity_key
REPLICATE_API_KEY=your_replicate_key
TOGETHER_API_KEY=your_together_key
CEREBRAS_API_KEY=your_cerebras_key
DEEPINFRA_API_KEY=your_deepinfra_key
BASETEN_API_KEY=your_baseten_key

# Voice & Specialized
ELEVENLABS_API_KEY=your_elevenlabs_key

# Cloud Services
# Azure OpenAI/Anthropic (use @ai-sdk/azure)
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint

# AWS Bedrock
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_aws_region

# Vercel AI Gateway (optional)
AI_GATEWAY_API_KEY=your_vercel_gateway_key
VERCEL_API_KEY=your_vercel_key

# Local/Community Providers
# Ollama (typically doesn't require API key, uses baseURL)
# OLLAMA_BASE_URL=http://localhost:11434
```

Or in provider config:

```typescript
await fred.useProvider('openai', { 
  apiKey: process.env.OPENAI_API_KEY 
});
```

**Note**: You only need to set the API key for the provider(s) you want to use. Fred will automatically detect available providers from environment variables.

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

