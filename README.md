# Fred

Fred is a flexible framework for building AI agents with intent-based routing, configurable agents with system messages and tool assignments, and support for multiple AI platforms (OpenAI, Groq, etc.) using Vercel AI SDK and Bun runtime.

📚 **[Full Documentation](https://sincspecv.github.io/fred)** - Complete guides, API reference, and examples

## Features

- **Intent-Based Routing**: Match user messages to intents using exact, regex, or semantic matching
- **Agent-Level Utterances**: Define utterances directly on agents for direct routing (bypasses intent matching)
- **Configurable Agents**: Define agents with system messages, AI platform integration, and tool assignments
- **Markdown System Prompts**: Store system prompts in markdown files for better organization
- **Dynamic Agent Handoff**: Agents can transfer conversations to other agents via tool calls
- **Pipeline Hooks**: Intercept and modify the message pipeline at 12 strategic points
- **MCP Server Integration**: Connect agents to MCP (Model Context Protocol) servers for automatic tool discovery
- **Tool Registry**: Reusable tools that can be shared across multiple agents
- **Multi-Platform Support**: Supports all @ai-sdk providers (OpenAI, Groq, Anthropic, Google, Mistral, Cohere, Vercel, Azure, Fireworks, XAI, Ollama, and 10+ more)
- **Flexible Configuration**: Use programmatic API or JSON/YAML config files
- **Library + Server Mode**: Use as a library or run as a standalone HTTP server

## Installation

### Using create-fred (Recommended)

The easiest way to get started is using `create-fred`:

```bash
bunx create-fred my-project
```

This will:
- Create a new Fred project with all necessary files
- Automatically install all dependencies
- Set up the embedded `fred` CLI for managing your project

### Manual Installation

```bash
# Install dependencies
bun install
```

## Quick Start

### Programmatic Usage

```typescript
import { Fred } from './src/index';

const fred = new Fred();

// Use providers with .useProvider() syntax (supports all @ai-sdk providers)
const groq = await fred.useProvider('groq', { apiKey: 'your-groq-api-key' });
const openai = await fred.useProvider('openai', { apiKey: 'your-openai-api-key' });
const anthropic = await fred.useProvider('anthropic', { apiKey: 'your-anthropic-api-key' });
const google = await fred.useProvider('google', { apiKey: 'your-google-api-key' });
const mistral = await fred.useProvider('mistral', { apiKey: 'your-mistral-api-key' });
// ... and many more (cohere, vercel, azure-openai, fireworks, xai, ollama, etc.)

// Or register default providers (uses environment variables)
fred.registerDefaultProviders();

// Register a tool
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['add', 'subtract'] },
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['operation', 'a', 'b'],
  },
  execute: async (args) => {
    return args.operation === 'add' ? args.a + args.b : args.a - args.b;
  },
});

// Create an agent with markdown system prompt
await fred.createAgent({
  id: 'math-agent',
  systemMessage: './prompts/math-agent.md', // File path or string
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
  utterances: ['calculate', 'math', 'compute'], // Direct routing via utterances
});

// Set a default agent (handles unmatched messages)
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});
fred.setDefaultAgent('default-agent');

// Register an intent
fred.registerIntent({
  id: 'math-question',
  utterances: ['calculate', 'compute', 'what is'],
  action: {
    type: 'agent',
    target: 'math-agent',
  },
});

// Process a message (with conversation context)
const response = await fred.processMessage('What is 15 + 27?', {
  conversationId: 'my-conversation-id', // Optional: maintains context across messages
});
console.log(response.content);
```

### Config File Usage

Create a config file (`config.yaml` or `config.json`):

```yaml
intents:
  - id: greeting
    utterances:
      - hello
      - hi
    action:
      type: agent
      target: greeting-agent

agents:
  - id: greeting-agent
    systemMessage: ./prompts/greeting-agent.md  # File path or string
    utterances:  # Direct routing (takes priority over intents)
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

Initialize from config:

```typescript
import { Fred } from './src/index';

const fred = new Fred();

// Provide tool executors for tools defined in config
const toolExecutors = new Map();
toolExecutors.set('calculator', async (args) => {
  // Implementation
});

await fred.initializeFromConfig('config.json', {
  toolExecutors,
});
```

### Development Mode (Interactive Chat)

Start the interactive development chat interface:

```bash
bun run dev
```

This starts a terminal chat interface that:
- Automatically reloads when code changes (hot reload)
- Maintains conversation context until terminal is closed
- Works great for testing agents and intents during development

Commands available in dev chat:
- `exit` or `quit` - Exit the chat
- `clear` or `/clear` - Clear conversation context
- `help` or `/help` - Show help message

### Server Mode

Start the HTTP server:

```bash
# With config file
bun run server --config config.json --port 3000

# Without config (programmatic setup)
bun run server --port 3000
```

API Endpoints:

- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint (works with Misty, Chatbox, etc.)
  ```json
  {
    "messages": [
      { "role": "user", "content": "Hello!" }
    ],
    "conversation_id": "optional-conversation-id",
    "stream": false
  }
  ```

- `POST /chat` - Simplified chat endpoint
  ```json
  {
    "message": "Hello!",
    "conversation_id": "optional-conversation-id"
  }
  ```

- `POST /message` - Process a user message
  ```json
  {
    "message": "hello",
    "options": {
      "useSemanticMatching": true,
      "semanticThreshold": 0.6,
      "conversationId": "optional-conversation-id"
    }
  }
  ```

- `GET /agents` - List all agents
- `GET /intents` - List all intents
- `GET /tools` - List all tools
- `GET /health` - Health check

### Embedded CLI Commands

Projects created with `create-fred` include a built-in CLI for managing your project:

```bash
# Add a new AI provider
fred provider add groq

# Remove a provider
fred provider remove openai

# List installed providers
fred provider list

# Create a new agent (interactive)
fred agent create

# Create a new tool (interactive)
fred tool create

# Show help
fred help
```

The CLI automatically:
- Installs/removes provider packages
- Updates `package.json` and `.env.example` (with placeholder values only)
- Scaffolds agent and tool files
- Updates `src/index.ts` with imports and registrations

**Security Note:** The CLI should write placeholder values (e.g., `OPENAI_API_KEY=your_openai_api_key_here`) to `.env.example`, not actual API keys. Real API keys belong only in `.env` (which is gitignored).

See the [CLI Guide](https://sincspecv.github.io/fred/guides/cli/) for complete documentation.

## Architecture

Fred consists of three main layers:

1. **Intent System**: Matches user utterances to intents and routes to actions
2. **Agent System**: Manages AI agents with system messages, platform integrations, and tools
3. **Tool System**: Registry of reusable tools that can be assigned to agents

### Routing Priority

Fred routes messages in the following priority order:

1. **Agent Utterances**: Direct routing via agent-level utterances (highest priority)
2. **Intent Matching**: Match against registered intents
3. **Default Agent**: Fallback to default agent if no match found

### Intent Matching

Fred uses a hybrid matching strategy:

1. **Exact Match**: Try exact string matching first
2. **Regex Match**: Try regex pattern matching
3. **Semantic Match**: Fallback to semantic similarity (configurable threshold)

### Agents

Agents are configured with:
- System message (defines behavior/personality) - supports markdown files or strings
- Utterances (optional) - phrases that trigger direct routing to this agent
- AI platform (OpenAI, Groq, Anthropic, etc.)
- Model identifier
- Tool assignments
- Optional temperature and max tokens

Agents can also hand off conversations to other agents using the built-in `handoff_to_agent` tool.

### Tools

Tools are defined with:
- ID, name, and description
- Parameter schema (JSON Schema format)
- Execute function

## Supported Providers

Fred supports all official @ai-sdk providers out of the box:

- **OpenAI** (`openai`) - GPT-4, GPT-3.5, and more
- **Anthropic** (`anthropic`) - Claude models
- **Google** (`google`) - Gemini models
- **Groq** (`groq`) - Fast inference
- **Mistral** (`mistral`) - Mistral AI models
- **Cohere** (`cohere`) - Cohere models
- **Vercel** (`vercel`) - Vercel's v0 API
- **Azure OpenAI** (`azure-openai` or `azure`) - Azure-hosted OpenAI
- **Azure Anthropic** (`azure-anthropic`) - Azure-hosted Anthropic
- **Fireworks** (`fireworks`) - Fireworks AI
- **X.AI** (`xai`) - Grok models
- **Ollama** (`ollama`) - Local models
- **AI21** (`ai21`) - Jurassic models
- **NVIDIA** (`nvidia`) - NVIDIA NIM
- **Amazon Bedrock** (`bedrock` or `amazon-bedrock`) - AWS Bedrock
- **Cloudflare** (`cloudflare`) - Cloudflare Workers AI
- **ElevenLabs** (`elevenlabs`) - Voice AI
- **Lepton** (`lepton`) - Lepton AI
- **Perplexity** (`perplexity`) - Perplexity AI
- **Replicate** (`replicate`) - Replicate models
- **Together** (`together`) - Together AI
- **Upstash** (`upstash`) - Upstash AI

## Environment Variables

Set API keys for AI platforms:

```bash
export OPENAI_API_KEY=your_openai_key
export GROQ_API_KEY=your_groq_key
export ANTHROPIC_API_KEY=your_anthropic_key
# ... and so on for other providers
```

Or use the `.useProvider()` syntax (accepts same parameters as AI SDK providers):

```typescript
// Basic usage with API key
const openai = await fred.useProvider('openai', { apiKey: 'your_key' });
const groq = await fred.useProvider('groq', { apiKey: 'your_key' });

// With custom base URL
const anthropic = await fred.useProvider('anthropic', { 
  apiKey: 'your_key',
  baseURL: 'https://api.anthropic.com/v1'
});

// With custom headers
const google = await fred.useProvider('google', { 
  apiKey: 'your_key',
  headers: { 'X-Custom-Header': 'value' }
});

// With custom fetch implementation
const mistral = await fred.useProvider('mistral', {
  apiKey: 'your_key',
  fetch: customFetchImplementation
});

// All AI SDK provider options are supported
// ... and many more providers!
```

Or provide them in the provider config:

```typescript
fred.registerDefaultProviders({
  openai: { apiKey: 'your_key' },
  groq: { apiKey: 'your_key' },
});
```

## Advanced Features

### Markdown System Prompts

Store system prompts in markdown files for better organization:

```yaml
agents:
  - id: my-agent
    systemMessage: ./prompts/my-agent.md  # File path
    platform: openai
    model: gpt-4
```

The `systemMessage` field accepts both file paths (relative to config file) and literal strings.

### Agent-Level Utterances

Define utterances directly on agents for direct routing (bypasses intent matching):

```typescript
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant.',
  utterances: ['calculate', 'math', 'compute'], // Direct routing
  platform: 'openai',
  model: 'gpt-4',
});
```

### Dynamic Agent Handoff

Agents can transfer conversations to other agents:

```typescript
// The handoff_to_agent tool is automatically available to all agents
// Agents can call it in their responses to transfer to another agent
```

### Pipeline Hooks

Intercept and modify the message pipeline at strategic points:

```typescript
fred.registerHook('beforeToolCalled', async (event) => {
  console.log('Tool about to be called:', event.data);
  return { context: { timestamp: Date.now() } };
});
```

Available hook points: `beforeMessageReceived`, `afterMessageReceived`, `beforeIntentDetermined`, `afterIntentDetermined`, `beforeAgentSelected`, `afterAgentSelected`, `beforeToolCalled`, `afterToolCalled`, `beforeResponseGenerated`, `afterResponseGenerated`, `beforeContextInserted`, `afterContextInserted`.

## Default Agent & Global Context

Fred supports a default agent that handles all unmatched messages, ensuring every message gets a response. Global context management maintains conversation history across all agents, making multi-agent conversations seamless.

### Setting Up a Default Agent

```typescript
// Create a default agent
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant that can answer general questions.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

// Set it as the default
fred.setDefaultAgent('default-agent');
```

### Using Global Context

```typescript
// Process messages with conversation ID for context
const conversationId = 'my-conversation';

// First message
const response1 = await fred.processMessage('Hello!', { conversationId });

// Second message - context is maintained
const response2 = await fred.processMessage('What did I just say?', { conversationId });
// The agent remembers the previous conversation
```

### OpenAI-Compatible Chat API

Fred provides an OpenAI-compatible `/v1/chat/completions` endpoint that works with standard AI chat tools:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Hello!" }
    ],
    "conversation_id": "my-conversation"
  }'
```

This endpoint is compatible with:
- **Misty** - AI chat interface
- **Chatbox** - Desktop AI chat app
- **Any OpenAI-compatible tool** - Works with tools that use OpenAI's API format

## Examples

See the `examples/` directory for more examples:

- `examples/basic/index.ts` - Basic programmatic usage
- `examples/server/index.ts` - Server mode example
- `examples/default-agent/index.ts` - Default agent setup example
- `examples/chat-tool/index.ts` - Chat tool integration example
- `examples/config-example.json` - Example config file

## Development

```bash
# Run tests
bun test

# Build
bun run build

# Run server in dev mode
bun run dev
```

## License

MIT

