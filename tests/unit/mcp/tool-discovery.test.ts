import { describe, it, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import { MCPServerRegistry } from '../../../packages/core/src/mcp/registry';
import type { MCPServerConfig, MCPClient } from '../../../packages/core/src/mcp/types';

// Mock MCP Client with controllable tool responses and connection state
class MockMCPClient implements MCPClient {
  private _connected = true;
  private _tools: Array<{ name: string; description: string; inputSchema: any }> = [];

  constructor(tools: Array<{ name: string; description: string; inputSchema: any }> = [], autoConnect = true) {
    this._tools = tools;
    this._connected = autoConnect;
  }

  disconnect() {
    this._connected = false;
  }

  async initialize() {
    this._connected = true;
    return {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'mock', version: '1.0.0' },
    };
  }

  async listTools() {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return this._tools;
  }

  async callTool(name: string, args: Record<string, any>) {
    if (!this._connected) {
      throw new Error('Server disconnected');
    }
    return { result: `called ${name} with ${JSON.stringify(args)}` };
  }

  async listResources() {
    return [];
  }

  async readResource(uri: string) {
    return { contents: [] };
  }

  async listPrompts() {
    return [];
  }

  async getPrompt(name: string, args?: Record<string, any>) {
    return { messages: [] };
  }

  async close() {
    this._connected = false;
  }

  isConnected() {
    return this._connected;
  }
}

describe('MCP Tool Discovery', () => {
  let registry: MCPServerRegistry;

  beforeEach(() => {
    registry = new MCPServerRegistry();
  });

  describe('namespaced tool IDs', () => {
    it('should return tools with server/tool namespace format', async () => {
      const mockTools = [
        {
          name: 'create_issue',
          description: 'Create a GitHub issue',
          inputSchema: { type: 'object' as const, properties: { title: { type: 'string' } } },
        },
        {
          name: 'close_issue',
          description: 'Close a GitHub issue',
          inputSchema: { type: 'object' as const, properties: { number: { type: 'number' } } },
        },
        {
          name: 'search',
          description: 'Search GitHub',
          inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } } },
        },
      ];

      const client = new MockMCPClient(mockTools);
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('github', config, client));

      const tools = await Effect.runPromise(registry.discoverTools('github'));

      expect(tools).toHaveLength(3);
      expect(tools[0].id).toBe('github/create_issue');
      expect(tools[0].name).toBe('github/create_issue');
      expect(tools[1].id).toBe('github/close_issue');
      expect(tools[1].name).toBe('github/close_issue');
      expect(tools[2].id).toBe('github/search');
      expect(tools[2].name).toBe('github/search');
    });

    it('should prevent namespace collisions between servers', async () => {
      const searchTool = {
        name: 'search',
        description: 'Search',
        inputSchema: { type: 'object' as const, properties: {} },
      };

      const githubClient = new MockMCPClient([searchTool]);
      const filesystemClient = new MockMCPClient([searchTool]);

      await Effect.runPromise(registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, githubClient));
      await Effect.runPromise(registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, filesystemClient));

      const githubTools = await Effect.runPromise(registry.discoverTools('github'));
      const fsTools = await Effect.runPromise(registry.discoverTools('filesystem'));

      // Both have 'search' but with different namespaces
      expect(githubTools[0].id).toBe('github/search');
      expect(fsTools[0].id).toBe('filesystem/search');
      expect(githubTools[0].id).not.toBe(fsTools[0].id);
    });
  });

  describe('discoverAllTools', () => {
    it('should discover tools from all registered servers', async () => {
      const githubTools = [
        {
          name: 'create_issue',
          description: 'Create issue',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'close_issue',
          description: 'Close issue',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ];

      const fsTools = [
        {
          name: 'read_file',
          description: 'Read file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'write_file',
          description: 'Write file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ];

      const githubClient = new MockMCPClient(githubTools);
      const fsClient = new MockMCPClient(fsTools);

      await Effect.runPromise(registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, githubClient));
      await Effect.runPromise(registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, fsClient));

      const allTools = await Effect.runPromise(registry.discoverAllTools());

      expect(allTools.size).toBe(2);
      expect(allTools.get('github')).toHaveLength(2);
      expect(allTools.get('filesystem')).toHaveLength(2);
      expect(allTools.get('github')![0].id).toBe('github/create_issue');
      expect(allTools.get('github')![1].id).toBe('github/close_issue');
      expect(allTools.get('filesystem')![0].id).toBe('filesystem/read_file');
      expect(allTools.get('filesystem')![1].id).toBe('filesystem/write_file');
    });

    it('should skip disconnected servers without throwing', async () => {
      const githubTools = [
        {
          name: 'create_issue',
          description: 'Create issue',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ];

      const fsTools = [
        {
          name: 'read_file',
          description: 'Read file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ];

      const githubClient = new MockMCPClient(githubTools);
      const fsClient = new MockMCPClient(fsTools);

      await Effect.runPromise(registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, githubClient));
      await Effect.runPromise(registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, fsClient));

      // Disconnect github client
      githubClient.disconnect();

      const allTools = await Effect.runPromise(registry.discoverAllTools());

      // Should only get filesystem tools, github skipped
      expect(allTools.size).toBe(1);
      expect(allTools.get('filesystem')).toHaveLength(1);
      expect(allTools.has('github')).toBe(false);
    });

    it('should return empty map when no servers registered', async () => {
      const allTools = await Effect.runPromise(registry.discoverAllTools());

      expect(allTools.size).toBe(0);
    });
  });

  describe('tool execution', () => {
    it('should execute tool successfully when server connected', async () => {
      const mockTools = [
        {
          name: 'create_issue',
          description: 'Create issue',
          inputSchema: { type: 'object' as const, properties: { title: { type: 'string' } } },
        },
      ];

      const client = new MockMCPClient(mockTools);
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('github', config, client));

      const tools = await Effect.runPromise(registry.discoverTools('github'));
      const tool = tools[0];

      const result = await tool.execute({ title: 'Test Issue' });

      expect(result).toBeDefined();
      expect(result).toContain('called create_issue');
    });

    it('should return error message when server disconnected during execution', async () => {
      const mockTools = [
        {
          name: 'create_issue',
          description: 'Create issue',
          inputSchema: { type: 'object' as const, properties: { title: { type: 'string' } } },
        },
      ];

      const client = new MockMCPClient(mockTools);
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('github', config, client));

      const tools = await Effect.runPromise(registry.discoverTools('github'));
      const tool = tools[0];

      // Disconnect client after discovery but before execution
      client.disconnect();

      const result = await tool.execute({ title: 'Test Issue' });

      // Should return error message, not throw
      expect(typeof result).toBe('string');
      expect(result).toContain('Tool github/create_issue failed');
      expect(result).toContain('disconnected');
    });

    it('should return error message on execution timeout', async () => {
      const mockTools = [
        {
          name: 'slow_tool',
          description: 'Slow tool',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ];

      // Create a client that throws timeout error
      class TimeoutClient extends MockMCPClient {
        async callTool(name: string, args: Record<string, any>) {
          throw new Error('timeout');
        }
      }

      const client = new TimeoutClient(mockTools);
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('github', config, client));

      const tools = await Effect.runPromise(registry.discoverTools('github'));
      const tool = tools[0];

      const result = await tool.execute({});

      // Should return error message, not throw
      expect(typeof result).toBe('string');
      expect(result).toContain('Tool github/slow_tool failed');
      expect(result).toContain('timeout');
    });
  });
});
