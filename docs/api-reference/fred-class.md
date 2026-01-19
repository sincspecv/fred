# Fred Class

The main class for building AI agents with intent-based routing.

## Constructor

```typescript
const fred = new Fred();
```

Creates a new Fred instance with default configuration.

## Methods

### useProvider()

Register an AI provider.

```typescript
await fred.useProvider(platform: string, config?: ProviderConfig): Promise<AIProvider>
```

**Parameters:**
- `platform`: Platform name ('openai', 'groq', 'anthropic', etc.)
- `config`: Optional provider configuration

**Returns:** Provider instance

**Example:**

```typescript
const openai = await fred.useProvider('openai', { apiKey: 'your-key' });
```

### use()

Register a custom integration/plugin.

```typescript
fred.use(name: string, integration: ((fred: Fred) => void) | any): Fred
```

**Parameters:**
- `name`: Integration name
- `integration`: Integration function or object

**Returns:** Fred instance (for chaining)

**Example:**

```typescript
fred.use('custom-logger', (fred) => {
  // Custom integration
});
```

### registerDefaultProviders()

Register default providers (OpenAI and Groq).

```typescript
fred.registerDefaultProviders(config?: {
  openai?: ProviderConfig;
  groq?: ProviderConfig;
  [key: string]: ProviderConfig | undefined;
}): void
```

**Example:**

```typescript
fred.registerDefaultProviders({
  openai: { apiKey: 'your-key' },
  groq: { apiKey: 'your-key' },
});
```

### registerTool()

Register a tool.

```typescript
fred.registerTool(tool: Tool): void
```

**Example:**

```typescript
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform arithmetic',
  parameters: { /* ... */ },
  execute: async (args) => { /* ... */ },
  strict: false, // Optional: Enable strict validation (AI SDK v6)
});
```

### registerTools()

Register multiple tools.

```typescript
fred.registerTools(tools: Tool[]): void
```

### getTool()

Get a tool by ID.

```typescript
fred.getTool(id: string): Tool | undefined
```

### registerIntent()

Register an intent.

```typescript
fred.registerIntent(intent: Intent): void
```

**Example:**

```typescript
fred.registerIntent({
  id: 'greeting',
  utterances: ['hello', 'hi'],
  action: { type: 'agent', target: 'agent-id' },
});
```

### registerIntents()

Register multiple intents.

```typescript
fred.registerIntents(intents: Intent[]): void
```

### createAgent()

Create an agent from configuration.

```typescript
await fred.createAgent(config: AgentConfig): Promise<AgentInstance>
```

**Example:**

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are helpful.',
  platform: 'openai',
  model: 'gpt-4',
});
```

### getAgent()

Get an agent by ID.

```typescript
fred.getAgent(id: string): AgentInstance | undefined
```

### setDefaultAgent()

Set the default agent (fallback for unmatched messages).

```typescript
fred.setDefaultAgent(agentId: string): void
```

**Example:**

```typescript
await fred.createAgent({ id: 'default', /* ... */ });
fred.setDefaultAgent('default');
```

### getDefaultAgentId()

Get the default agent ID.

```typescript
fred.getDefaultAgentId(): string | undefined
```

### processMessage()

Process a user message through the intent system.

```typescript
await fred.processMessage(
  message: string,
  options?: {
    useSemanticMatching?: boolean;
    semanticThreshold?: number;
    conversationId?: string;
  }
): Promise<AgentResponse | null>
```

**Example:**

```typescript
const response = await fred.processMessage('Hello!', {
  conversationId: 'conv-123',
});
```

### processChatMessage()

Process OpenAI-compatible chat messages.

```typescript
await fred.processChatMessage(
  messages: Array<{ role: string; content: string }>,
  options?: {
    conversationId?: string;
    useSemanticMatching?: boolean;
    semanticThreshold?: number;
  }
): Promise<AgentResponse | null>
```

**Example:**

```typescript
const response = await fred.processChatMessage([
  { role: 'user', content: 'Hello!' }
], {
  conversationId: 'conv-123',
});
```

### initializeFromConfig()

Initialize from a config file.

```typescript
await fred.initializeFromConfig(
  configPath: string,
  options?: {
    toolExecutors?: Map<string, Tool['execute']>;
    providers?: {
      openai?: ProviderConfig;
      groq?: ProviderConfig;
    };
  }
): Promise<void>
```

**Example:**

```typescript
await fred.initializeFromConfig('config.json', {
  toolExecutors: new Map(),
});
```

### getIntents()

Get all registered intents.

```typescript
fred.getIntents(): Intent[]
```

### getAgents()

Get all agents.

```typescript
fred.getAgents(): AgentInstance[]
```

### getTools()

Get all tools.

```typescript
fred.getTools(): Tool[]
```

### getContextManager()

Get the context manager instance.

```typescript
fred.getContextManager(): ContextManager
```

## Examples

### Basic Usage

```typescript
const fred = new Fred();
await fred.useProvider('openai', { apiKey: 'key' });
await fred.createAgent({ id: 'agent', /* ... */ });
fred.setDefaultAgent('agent');
const response = await fred.processMessage('Hello!');
```

### With Config File

```typescript
const fred = new Fred();
await fred.initializeFromConfig('config.json');
const response = await fred.processMessage('Hello!');
```

