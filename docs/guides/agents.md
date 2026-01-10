# Agents

Agents are the core of Fred. They represent AI assistants with specific behaviors, capabilities, and tools.

## Creating Agents

### Basic Agent

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});
```

### Agent with Tools

```typescript
// Register tools first
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform arithmetic',
  parameters: { /* ... */ },
  execute: async (args) => { /* ... */ },
});

// Create agent with tools
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'], // Reference tool IDs
});
```

### Agent Configuration Options

```typescript
await fred.createAgent({
  id: 'custom-agent',
  systemMessage: 'You are a creative writer.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['tool1', 'tool2'],
  utterances: ['write', 'story', 'creative'], // Optional: direct routing
  temperature: 0.8,      // Creativity level (0-1)
  maxTokens: 2000,       // Maximum response length
});
```

### Agent-Level Utterances

Agents can define utterances directly for automatic routing (bypasses intent matching):

```typescript
await fred.createAgent({
  id: 'math-agent',
  systemMessage: 'You are a math assistant.',
  utterances: ['calculate', 'math', 'compute', 'solve'], // Direct routing
  platform: 'openai',
  model: 'gpt-4',
});

// Messages matching these utterances route directly to math-agent
// (takes priority over intent-based routing)
```

Routing priority: **Agent utterances → Intents → Default agent**

## System Messages

System messages define the agent's personality and behavior. You can use either string content or file paths to markdown files:

```typescript
// String content
systemMessage: 'You are a friendly and helpful assistant.'

// Markdown file path (relative to config file or current working directory)
systemMessage: './prompts/my-agent.md'

// Expert in a domain
systemMessage: 'You are an expert software engineer specializing in TypeScript and AI.'

// Specific role
systemMessage: 'You are a customer support agent. Be professional and empathetic.'
```

### Markdown System Prompts

Store complex system prompts in markdown files for better organization:

**prompts/math-agent.md:**
```markdown
# Math Assistant

You are an expert mathematics assistant. Your role is to:

- Help users solve mathematical problems
- Explain mathematical concepts clearly
- Use the calculator tool when needed for computations

## Guidelines

- Always show your work
- Explain steps clearly
- Double-check calculations
```

**config.yaml:**
```yaml
agents:
  - id: math-agent
    systemMessage: ./prompts/math-agent.md
    platform: openai
    model: gpt-4
```

The system automatically loads markdown files when a file path is detected (starts with `./`, `/`, or ends with `.md`/`.markdown`).

## Platform and Model Selection

### OpenAI

```typescript
await fred.useProvider('openai', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'openai',
  model: 'gpt-4',           // or 'gpt-3.5-turbo', 'gpt-4-turbo', etc.
});
```

### Groq

```typescript
await fred.useProvider('groq', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'groq',
  model: 'llama-3.1-70b-versatile',  // or 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'
});
```

### Anthropic

```typescript
await fred.useProvider('anthropic', { apiKey: 'your-key' });

await fred.createAgent({
  platform: 'anthropic',
  model: 'claude-3-opus-20240229',  // or other Claude models
});
```

## Using Agents

### Direct Agent Access

```typescript
const agent = fred.getAgent('my-agent');
if (agent) {
  const response = await agent.processMessage('Hello!');
}
```

### Through Intent Routing

```typescript
fred.registerIntent({
  id: 'math',
  utterances: ['calculate', 'math'],
  action: {
    type: 'agent',
    target: 'math-agent',  // Routes to this agent
  },
});

const response = await fred.processMessage('Calculate 5 + 3');
// Automatically routes to math-agent
```

### As Default Agent

```typescript
await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-3.5-turbo',
});

fred.setDefaultAgent('default-agent');

// All unmatched messages go to default-agent
const response = await fred.processMessage('Hello!');
```

## Agent Response

Agents return responses with content and optional tool calls:

```typescript
const response = await agent.processMessage('Calculate 10 * 5');

console.log(response.content);  // "The result is 50"
console.log(response.toolCalls); // Array of tool calls if any
```

## Dynamic Agent Handoff

Agents can transfer conversations to other agents using the built-in `handoff_to_agent` tool. This tool is automatically available to all agents:

```typescript
// Agent A can hand off to Agent B
// The handoff tool is called automatically when an agent decides to transfer
// The system processes handoffs recursively (with max depth protection)
```

The handoff tool accepts:
- `agentId` (required): The ID of the target agent
- `message` (optional): Custom message for the target agent
- `context` (optional): Additional context to pass along

Handoffs are processed automatically in the message pipeline, allowing for seamless multi-agent conversations.

## MCP Server Integration

Agents can connect to MCP (Model Context Protocol) servers to automatically discover and use tools, resources, and prompts from external MCP servers. MCP tools are seamlessly integrated with the AI SDK and work just like regular tools.

### Configuring MCP Servers

#### stdio Transport (Local Servers)

Connect to local MCP servers running as subprocesses:

```typescript
await fred.createAgent({
  id: 'code-agent',
  systemMessage: 'You are a coding assistant.',
  platform: 'openai',
  model: 'gpt-4',
  mcpServers: [
    {
      id: 'filesystem',
      name: 'File System',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/allowed/path'],
      env: {
        // Optional environment variables
      },
    },
  ],
});
```

#### HTTP/SSE Transport (Remote Servers)

Connect to remote MCP servers via HTTP:

```typescript
await fred.createAgent({
  id: 'github-agent',
  systemMessage: 'You are a GitHub assistant.',
  platform: 'openai',
  model: 'gpt-4',
  mcpServers: [
    {
      id: 'github',
      name: 'GitHub',
      transport: 'http',
      url: 'https://mcp-server.example.com',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
      timeout: 30000, // Optional timeout in ms
    },
  ],
});
```

### MCP Tools

MCP tools are automatically discovered and made available to the agent. They work seamlessly with the AI SDK's tool calling system:

- Tools are discovered when the agent is created
- Tool IDs are prefixed with `mcp-{serverId}-{toolName}` to avoid conflicts
- Tools are registered in the tool registry and can be referenced by ID
- AI SDK's `generateText` automatically handles MCP tool calls

### MCP Configuration Options

```typescript
interface MCPServerConfig {
  id: string;                    // Unique identifier
  name?: string;                 // Optional display name
  transport: 'stdio' | 'http' | 'sse';
  
  // For stdio transport
  command?: string;              // Command to run
  args?: string[];               // Command arguments
  env?: Record<string, string>;  // Environment variables
  
  // For HTTP/SSE transport
  url?: string;                  // Server URL
  headers?: Record<string, string>; // Optional headers
  
  // Optional configuration
  enabled?: boolean;             // Enable/disable (default: true)
  timeout?: number;              // Connection timeout in ms (default: 30000)
}
```

### Error Handling

MCP server connection failures are handled gracefully:
- If an MCP server fails to connect, the agent is still created
- Errors are logged but don't prevent agent creation
- Connection retries are automatic (up to 3 attempts with exponential backoff)
- Timeouts are configurable per server

### Best Practices

1. **Use stdio for local servers**: More efficient for local MCP servers
2. **Use HTTP for remote servers**: Better for distributed setups
3. **Set appropriate timeouts**: Adjust based on network conditions
4. **Handle errors gracefully**: MCP servers are optional - agents work without them
5. **Prefix tool IDs**: MCP tools are automatically prefixed to avoid conflicts

## Best Practices

1. **Clear System Messages**: Be specific about the agent's role and behavior
2. **Appropriate Models**: Use faster/cheaper models for simple tasks, powerful models for complex ones
3. **Tool Assignment**: Only assign relevant tools to agents
4. **Default Agent**: Always set a default agent to handle unmatched messages
5. **Temperature**: Adjust based on need (lower for factual, higher for creative)

## Next Steps

- Learn about [Intents](intents.md)
- Explore [Tools](tools.md)
- Check [Default Agent](default-agent.md)
- See [MCP Server Integration Example](../examples/mcp-server-integration.md)

