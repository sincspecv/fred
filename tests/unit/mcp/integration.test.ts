import { describe, test, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import { MCPServerRegistry, MCPResourceService } from '../../../packages/core/src/mcp';
import type { MCPGlobalServerConfig } from '../../../packages/core/src/config/types';
import { extractMCPServers } from '../../../packages/core/src/config/loader';
import type { MCPClientImpl } from '../../../packages/core/src/mcp/client';
import type { Tool } from '../../../packages/core/src/tool/tool';
import * as Schema from 'effect/Schema';

// Mock MCP client for testing
class MockMCPClient implements MCPClientImpl {
  private _connected = true;
  private tools: Array<{ name: string; description: string; inputSchema: any }> = [];
  private resources: Array<{ uri: string; name: string; mimeType?: string }> = [];

  constructor(
    public config: any,
    tools?: Array<{ name: string; description: string; inputSchema: any }>,
    resources?: Array<{ uri: string; name: string; mimeType?: string }>
  ) {
    this.tools = tools ?? [];
    this.resources = resources ?? [];
  }

  async initialize(): Promise<void> {
    this._connected = true;
  }

  async close(): Promise<void> {
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: any }>> {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return this.tools;
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return {
      content: [{ type: 'text', text: `Tool ${name} executed with params: ${JSON.stringify(params)}` }],
    };
  }

  async listResources(): Promise<Array<{ uri: string; name: string; mimeType?: string }>> {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return this.resources;
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return {
      contents: [{ uri, mimeType: 'text/plain', text: `Resource content for ${uri}` }],
    };
  }

  setConnected(connected: boolean): void {
    this._connected = connected;
  }
}

describe('MCP Integration Tests', () => {
  let registry: MCPServerRegistry;
  let resourceService: MCPResourceService;

  beforeEach(() => {
    registry = new MCPServerRegistry();
    resourceService = new MCPResourceService(registry);
  });

  describe('Config-to-Registry Flow', () => {
    test('extracts MCP servers from config with correct types', () => {
      const config = {
        mcpServers: {
          'server1': {
            transport: 'stdio' as const,
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            timeout: 30000,
            enabled: true,
            lazy: false,
          },
          'server2': {
            transport: 'http' as const,
            url: 'http://localhost:3000',
            timeout: 30000,
            enabled: true,
            lazy: true,
          },
        },
      };

      const servers = extractMCPServers(config);

      expect(servers).toHaveLength(2);
      expect(servers[0]).toMatchObject({
        id: 'server1',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        timeout: 30000,
        enabled: true,
        lazy: false,
      });
      expect(servers[1]).toMatchObject({
        id: 'server2',
        transport: 'http',
        url: 'http://localhost:3000',
        timeout: 30000,
        enabled: true,
        lazy: true,
      });
    });

    test('resolves environment variables in config values', () => {
      process.env.TEST_MCP_TOKEN = 'secret-token-123';
      process.env.TEST_MCP_URL = 'https://api.example.com';

      const config = {
        mcpServers: {
          'github': {
            transport: 'http' as const,
            url: '${TEST_MCP_URL}',
            headers: {
              Authorization: 'Bearer ${TEST_MCP_TOKEN}',
            },
          },
        },
      };

      const servers = extractMCPServers(config);

      expect(servers[0].url).toBe('https://api.example.com');
      expect(servers[0].headers).toEqual({
        Authorization: 'Bearer secret-token-123',
      });

      delete process.env.TEST_MCP_TOKEN;
      delete process.env.TEST_MCP_URL;
    });

    test('registers servers in MCPServerRegistry', async () => {
      const mockClient = new MockMCPClient({ id: 'test-server' });

      await Effect.runPromise(
        registry.registerServer('test-server', { id: 'test-server', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      const client = registry.getClient('test-server');
      expect(client).toBeDefined();
      expect(client).toBe(mockClient);
    });
  });

  describe('Agent-to-Tools Flow', () => {
    test('agent gets namespaced tools from registered servers', async () => {
      const server1Tools = [
        { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { type: 'object', properties: {} } },
        { name: 'list_repos', description: 'List repositories', inputSchema: { type: 'object', properties: {} } },
      ];

      const server2Tools = [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
      ];

      const mockClient1 = new MockMCPClient({ id: 'github' }, server1Tools);
      const mockClient2 = new MockMCPClient({ id: 'filesystem' }, server2Tools);

      await Effect.runPromise(
        registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, mockClient1 as any)
      );
      await Effect.runPromise(
        registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, mockClient2 as any)
      );

      const githubTools = await Effect.runPromise(registry.discoverTools('github'));
      const filesystemTools = await Effect.runPromise(registry.discoverTools('filesystem'));

      expect(githubTools).toHaveLength(2);
      expect(githubTools[0].id).toBe('github/create_issue');
      expect(githubTools[0].name).toBe('github/create_issue');
      expect(githubTools[1].id).toBe('github/list_repos');

      expect(filesystemTools).toHaveLength(1);
      expect(filesystemTools[0].id).toBe('filesystem/read_file');
      expect(filesystemTools[0].name).toBe('filesystem/read_file');
    });

    test('tools have correct server/tool namespace format', async () => {
      const tools = [
        { name: 'search', description: 'Search GitHub', inputSchema: { type: 'object', properties: {} } },
      ];

      const mockClient = new MockMCPClient({ id: 'github' }, tools);
      await Effect.runPromise(
        registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      const discoveredTools = await Effect.runPromise(registry.discoverTools('github'));

      expect(discoveredTools[0].id).toBe('github/search');
      expect(discoveredTools[0].name).toBe('github/search');
      expect(discoveredTools[0].id.includes('/')).toBe(true);
    });
  });

  describe('Lifecycle Flow', () => {
    test('lazy servers not connected at registration', () => {
      registry.registerLazyServer('lazy-server', {
        id: 'lazy-server',
        transport: 'stdio',
        command: 'test',
      });

      const client = registry.getClient('lazy-server');
      expect(client).toBeUndefined();
    });

    test('shutdown clears all connections', async () => {
      const mockClient1 = new MockMCPClient({ id: 'server1' });
      const mockClient2 = new MockMCPClient({ id: 'server2' });

      await Effect.runPromise(
        registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, mockClient1 as any)
      );
      await Effect.runPromise(
        registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, mockClient2 as any)
      );

      expect(registry.getRegisteredServers()).toHaveLength(2);

      await Effect.runPromise(registry.shutdown());

      expect(registry.getRegisteredServers()).toHaveLength(0);
      expect(mockClient1.isConnected()).toBe(false);
      expect(mockClient2.isConnected()).toBe(false);
    });

    test('health check setup for configured servers', async () => {
      const mockClient = new MockMCPClient({ id: 'test-server' });
      await Effect.runPromise(
        registry.registerServer('test-server', { id: 'test-server', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      // Start health checks (doesn't throw)
      registry.startHealthChecks();

      expect(registry.getServerStatus('test-server')).toBe('connected');
    });
  });

  describe('Error Resilience', () => {
    test('agent creation succeeds even when MCP server ref does not exist', async () => {
      // This is more of an integration test with AgentConfig, but we can verify registry behavior
      const client = registry.getClient('nonexistent-server');
      expect(client).toBeUndefined();

      // Tool discovery should fail gracefully
      const result = await Effect.runPromise(
        Effect.either(registry.discoverTools('nonexistent-server'))
      );

      expect(result._tag).toBe('Left');
    });

    test('tool call on disconnected server returns error, not crash', async () => {
      const mockClient = new MockMCPClient({ id: 'test-server' }, [
        { name: 'test_tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

      await Effect.runPromise(
        registry.registerServer('test-server', { id: 'test-server', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      // Get tools while connected
      const tools = await Effect.runPromise(registry.discoverTools('test-server'));
      expect(tools).toHaveLength(1);

      // Now disconnect the server
      mockClient.setConnected(false);
      registry.updateServerStatus('test-server', 'disconnected');

      // Execute tool - should return error message, not throw
      const tool = tools[0];
      const result = await tool.execute({ test: 'param' });

      // Tool execution should return error message
      expect(typeof result).toBe('string');
      expect(result).toContain('disconnected');
    });

    test('config with invalid MCP server warns but does not block startup', async () => {
      const consoleWarnSpy = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: any[]) => warnings.push(args.join(' '));

      // registerAndConnect handles failures gracefully
      await Effect.runPromise(
        registry.registerAndConnect('bad-server', {
          id: 'bad-server',
          transport: 'stdio',
          command: 'nonexistent-command-12345',
        })
      );

      // Server should not be registered
      const client = registry.getClient('bad-server');
      expect(client).toBeUndefined();

      // Should have logged a warning
      expect(warnings.length).toBeGreaterThan(0);

      console.warn = consoleWarnSpy;
    });

    test('discoverAllTools skips disconnected servers gracefully', async () => {
      const mockClient1 = new MockMCPClient({ id: 'server1' }, [
        { name: 'tool1', description: 'Tool 1', inputSchema: { type: 'object', properties: {} } },
      ]);
      const mockClient2 = new MockMCPClient({ id: 'server2' }, [
        { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object', properties: {} } },
      ]);

      await Effect.runPromise(
        registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, mockClient1 as any)
      );
      await Effect.runPromise(
        registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, mockClient2 as any)
      );

      // Disconnect server2
      mockClient2.setConnected(false);
      registry.updateServerStatus('server2', 'disconnected');

      const consoleWarnSpy = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: any[]) => warnings.push(args.join(' '));

      const toolsMap = await Effect.runPromise(registry.discoverAllTools());

      // Should have tools from server1 but not server2
      expect(toolsMap.has('server1')).toBe(true);
      expect(toolsMap.get('server1')).toHaveLength(1);
      expect(toolsMap.has('server2')).toBe(false);

      // Should have warned about server2
      expect(warnings.some(w => w.includes('server2'))).toBe(true);

      console.warn = consoleWarnSpy;
    });
  });

  describe('Resource Service Integration', () => {
    test('lists resources from specific server', async () => {
      const resources = [
        { uri: 'file:///test.txt', name: 'test.txt', mimeType: 'text/plain' },
      ];

      const mockClient = new MockMCPClient({ id: 'test-server' }, [], resources);
      await Effect.runPromise(
        registry.registerServer('test-server', { id: 'test-server', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      const result = await Effect.runPromise(resourceService.listResources('test-server'));

      expect(result).toHaveLength(1);
      expect(result[0].uri).toBe('file:///test.txt');
    });

    test('lists all resources from all servers', async () => {
      const resources1 = [{ uri: 'file:///a.txt', name: 'a.txt' }];
      const resources2 = [{ uri: 'file:///b.txt', name: 'b.txt' }];

      const mockClient1 = new MockMCPClient({ id: 'server1' }, [], resources1);
      const mockClient2 = new MockMCPClient({ id: 'server2' }, [], resources2);

      await Effect.runPromise(
        registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, mockClient1 as any)
      );
      await Effect.runPromise(
        registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, mockClient2 as any)
      );

      const result = await Effect.runPromise(resourceService.listAllResources());

      expect(result.has('server1')).toBe(true);
      expect(result.has('server2')).toBe(true);
      expect(result.get('server1')).toHaveLength(1);
      expect(result.get('server2')).toHaveLength(1);
    });

    test('reads resource from specific server', async () => {
      const mockClient = new MockMCPClient({ id: 'test-server' });
      await Effect.runPromise(
        registry.registerServer('test-server', { id: 'test-server', transport: 'stdio', command: 'test' }, mockClient as any)
      );

      const result = await Effect.runPromise(
        resourceService.readResource('test-server', 'file:///test.txt')
      );

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('file:///test.txt');
      expect(result.contents[0].text).toContain('Resource content');
    });
  });
});
