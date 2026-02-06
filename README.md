# Fred

Fred is a flexible framework for building AI agents with intent-based routing, configurable agents with system messages and tool assignments, and support for multiple AI platforms (OpenAI, Groq, etc.) using Vercel AI SDK and Bun runtime.

📚 **[Full Documentation](https://sincspecv.github.io/fred)** - Complete guides, API reference, and examples

## Features

- **Intent-Based Routing**: Match user messages to intents using exact, regex, or semantic matching
- **Agent-Level Utterances**: Define utterances directly on agents for direct routing (bypasses intent matching)
- **Configurable Agents**: Define agents with system messages, AI platform integration, and tool assignments. Built on AI SDK v6's ToolLoopAgent for automatic tool loop management.
- **Markdown System Prompts**: Store system prompts in markdown files for better organization
- **Dynamic Agent Handoff**: Agents can transfer conversations to other agents via tool calls
- **Pipeline Hooks**: Intercept and modify the message pipeline at 12 strategic points
- **MCP Server Integration**: Connect agents to MCP (Model Context Protocol) servers for automatic tool discovery
- **Tool Registry**: Reusable tools that can be shared across multiple agents
- **Multi-Platform Support**: Supports all @ai-sdk providers (OpenAI, Groq, Anthropic, Google, Mistral, Cohere, Vercel, Azure, Fireworks, XAI, Ollama, and 10+ more)
- **Flexible Configuration**: Use programmatic API or JSON/YAML config files
- **Library + Server Mode**: Use as a library or run as a standalone HTTP server
- **Observability & Tracing**: Lightweight tracing system with optional OpenTelemetry integration for full observability
- **Evaluation Harness**: Golden trace-based evaluation system for deterministic testing and regression detection

## Installation

### Package Installation

Fred is available as modular packages that you install based on your needs:

```bash
# Core package (required)
bun add @fancyrobot/fred effect

# Add AI providers as needed
bun add @fancyrobot/fred-openai @effect/ai-openai
bun add @fancyrobot/fred-anthropic @effect/ai-anthropic
bun add @fancyrobot/fred-google @effect/ai-google
bun add @fancyrobot/fred-groq @effect/platform
bun add @fancyrobot/fred-openrouter @effect/ai-openai

# Install CLI globally (optional)
bun add -g @fancyrobot/fred-cli
```

Each provider package auto-registers when imported - no additional configuration needed.

### Using create-fred (Recommended for New Projects)

The easiest way to start a new project is using `create-fred`:

```bash
bunx create-fred my-project
```

This will:
- Create a new Fred project with all necessary files
- Automatically install all dependencies
- Set up the embedded `fred` CLI for managing your project

### Development Installation

For contributing to Fred:

```bash
# Clone the repository
git clone https://github.com/TheFancyRobot/fred.git
cd fred

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
- **Works out of the box** - No configuration needed! Automatically creates a temporary dev agent if none are configured
- Automatically detects available AI providers from environment variables (e.g., `OPENAI_API_KEY`, `GROQ_API_KEY`)
- Automatically installs required provider packages if missing (with user confirmation)
- Automatically reloads when code changes (hot reload)
- Maintains conversation context until terminal is closed
- Works great for testing agents and intents during development

**Zero-Config Experience:**
- If no agents are configured, dev-chat automatically creates a temporary dev agent
- Detects available providers from environment variables
- Prompts to install missing provider packages if needed
- Perfect for quick testing without setting up a full configuration

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

# Run golden trace tests
fred test

# Record a new golden trace
fred test --record "Hello, world!"

# Update existing traces
fred test --update

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

### Observability & Tracing

Fred includes comprehensive observability through a lightweight tracing system:

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// Enable tracing (opt-in, zero overhead when disabled)
fred.enableTracing();

// Process messages - spans are automatically created
const response = await fred.processMessage('Hello!');
```

Tracing instruments:
- Message routing and agent selection
- AI model calls with token usage
- Tool execution with timing
- Agent handoffs
- Pipeline hooks

Optional OpenTelemetry integration available. See [Observability Guide](https://sincspecv.github.io/fred/advanced/observability/) for details.

### Evaluation Harness

Test your agents with golden traces - deterministic snapshots of agent runs:

```bash
# Record a golden trace
fred test --record "Hello, world!"

# Run tests
fred test

# Update traces when behavior changes
fred test --update
```

Golden traces capture complete execution including spans, tool calls, handoffs, and routing decisions. Perfect for regression testing and CI/CD. See [Evaluation Guide](https://sincspecv.github.io/fred/guides/evaluation/) for details.

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
- Optional max steps (default: 20) - controls how many tool calls the agent can make in sequence
- Optional tool choice - control how the agent uses tools ('auto', 'required', 'none', or force specific tool)

Agents use AI SDK v6's `ToolLoopAgent` internally, which automatically handles tool execution loops. The agent can call multiple tools in sequence up to the configured step limit, with each step representing one generation (text or tool call).

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

Set API keys for AI platforms. Fred supports all @ai-sdk providers and automatically detects available providers from environment variables.

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
# Or use resource-specific variables:
# AZURE_OPENAI_RESOURCE_NAME=your_resource
# AZURE_OPENAI_DEPLOYMENT_NAME=your_deployment

# AWS Bedrock
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_aws_region

# Vercel AI Gateway (optional)
AI_GATEWAY_API_KEY=your_vercel_gateway_key
# Or use Vercel provider directly
VERCEL_API_KEY=your_vercel_key

# Local/Community Providers
# Ollama (typically doesn't require API key, uses baseURL)
# OLLAMA_BASE_URL=http://localhost:11434
```

**Note**: 
- You only need to add the API keys for the providers you want to use
- Make sure `.env` is in your `.gitignore` to avoid committing secrets
- For providers like Azure and AWS Bedrock, additional configuration may be required. See provider-specific documentation for details.

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

**Note**: In dev-chat mode (`bun run dev`), a temporary dev agent is automatically created if no agents are configured, so you can start testing immediately without setting up a default agent.

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

### Development Environment with Flox (Recommended)

For a consistent, reproducible development environment, Fred includes Flox configuration:

```bash
# Activate the Flox development environment
flox activate

# Or use the helper script
source scripts/flox-activate.sh
```

This provides:
- Consistent Bun version across all developers
- Isolated development environment
- Easy onboarding for new contributors

**Note**: Flox is optional. You can still use Bun directly if preferred.

### Manual Development Setup

If you prefer not to use Flox:

```bash
# Run all tests (unit tests + golden trace tests)
bun test:all

# Run only unit tests
bun test:unit

# Build
bun run build

# Run server in dev mode
bun run dev
```

### Testing

Fred includes comprehensive unit tests for deterministic functionality:

```bash
# Run all tests
bun test:all

# Run only unit tests (fast, no external dependencies)
bun test:unit

# Run tests matching a pattern
bun test tests/unit/core/tool

# Run a specific test file
bun test tests/unit/core/tool/registry.test.ts
```

The test suite covers:
- Tool registry and management
- Intent matching and routing
- Context management
- Hook system
- Configuration parsing and validation
- Validation utilities
- Semantic matching algorithms
- Path resolution and security

Tests use Bun's built-in test framework and focus on deterministic functionality. Non-deterministic operations (AI model calls, external APIs) are mocked. See [CONTRIBUTING.md](./CONTRIBUTING.md) for testing guidelines.

## License

MIT
