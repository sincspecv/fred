# MCP Server Integration Example

This example demonstrates how to integrate Fred agents with MCP (Model Context Protocol) servers. We'll use the filesystem MCP server, which is a common public MCP server that provides file operations.

## Prerequisites

The filesystem MCP server can be run via `npx` (no installation needed), or you can install it globally:

```bash
# Optional: Install globally
npm install -g @modelcontextprotocol/server-filesystem
```

## Complete Example

```typescript
import { Fred } from 'fred';

async function main() {
  const fred = new Fred();

  // Register a provider
  await fred.useProvider('openai', {
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Create an agent with MCP server integration
  await fred.createAgent({
    id: 'file-assistant',
    systemMessage: `You are a helpful file assistant. You can read and write files 
using the tools available from the MCP server.`,
    platform: 'openai',
    model: 'gpt-4',
    mcpServers: [
      {
        id: 'filesystem',
        name: 'File System',
        transport: 'stdio',
        command: 'npx',
        args: [
          '-y', // Automatically accept npx prompts
          '@modelcontextprotocol/server-filesystem',
          process.cwd(), // Allow access to current working directory
        ],
      },
    ],
  });

  // Set as default agent
  fred.setDefaultAgent('file-assistant');

  // Use the agent - MCP tools are automatically available
  const response = await fred.processMessage('Read the package.json file');
  console.log(response.content);
}

main().catch(console.error);
```

## Running the Example

```bash
# Set API key
export OPENAI_API_KEY=your_key

# Run the example
bun run examples/mcp-server/index.ts
```

## How It Works

1. **MCP Server Configuration**: The agent is configured with an MCP server that uses stdio transport
2. **Automatic Tool Discovery**: When the agent is created, Fred automatically:
   - Connects to the MCP server
   - Discovers available tools (e.g., `read_file`, `write_file`, `list_directory`)
   - Converts them to AI SDK tools using `tool()` and `jsonSchema()`
   - Registers them in the tool registry
3. **Seamless Integration**: The MCP tools work exactly like regular tools - the AI SDK handles tool calls automatically
4. **Tool Execution**: When the agent calls an MCP tool, Fred executes it via the MCP protocol

## Available Tools from Filesystem MCP Server

The filesystem MCP server typically provides:

- `read_file`: Read the contents of a file
- `write_file`: Write content to a file
- `list_directory`: List files and directories
- `get_file_info`: Get file metadata

Tool IDs are automatically prefixed: `mcp-filesystem-read_file`, `mcp-filesystem-write_file`, etc.

## Using Other MCP Servers

You can connect to any MCP server. Here are some examples:

### GitHub MCP Server

```typescript
await fred.createAgent({
  id: 'github-assistant',
  systemMessage: 'You are a GitHub assistant.',
  platform: 'openai',
  model: 'gpt-4',
  mcpServers: [
    {
      id: 'github',
      name: 'GitHub',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
      },
    },
  ],
});
```

### HTTP-Based MCP Server

```typescript
await fred.createAgent({
  id: 'remote-assistant',
  systemMessage: 'You are a remote assistant.',
  platform: 'openai',
  model: 'gpt-4',
  mcpServers: [
    {
      id: 'remote-server',
      name: 'Remote MCP Server',
      transport: 'http',
      url: 'https://mcp-server.example.com',
      headers: {
        Authorization: `Bearer ${process.env.MCP_API_KEY}`,
      },
      timeout: 30000,
    },
  ],
});
```

## Error Handling

MCP server connection failures are handled gracefully:

- If an MCP server fails to connect, the agent is still created
- Errors are logged but don't prevent agent creation
- Connection retries are automatic (up to 3 attempts)
- You can disable a server by setting `enabled: false`

```typescript
mcpServers: [
  {
    id: 'optional-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-example'],
    enabled: false, // Disable this server
  },
]
```

## Best Practices

1. **Use stdio for local servers**: More efficient for local MCP servers
2. **Use HTTP for remote servers**: Better for distributed setups
3. **Set appropriate timeouts**: Adjust based on network conditions
4. **Handle errors gracefully**: MCP servers are optional - agents work without them
5. **Limit file access**: Only allow access to necessary directories

## Next Steps

- Learn more about [MCP Server Integration](../guides/agents.md#mcp-server-integration)
- Explore [Agent Configuration](../api-reference/agents.md)
- Check [Configuration Guide](../getting-started/configuration.md)
