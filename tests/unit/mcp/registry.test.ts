import { describe, it, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import { MCPServerRegistry } from '../../../packages/core/src/mcp/registry';
import type { MCPServerConfig, MCPClient } from '../../../packages/core/src/mcp/types';
import type { Tool } from '../../../packages/core/src/tool/tool';

// Mock MCP Client
class MockMCPClient implements MCPClient {
  private _connected = false;
  private _tools: Array<{ name: string; description: string; inputSchema: any }> = [];

  constructor(tools: Array<{ name: string; description: string; inputSchema: any }> = []) {
    this._tools = tools;
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
    return this._tools;
  }

  async callTool(name: string, args: Record<string, any>) {
    return { result: `called ${name}` };
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

describe('MCPServerRegistry', () => {
  let registry: MCPServerRegistry;

  beforeEach(() => {
    registry = new MCPServerRegistry();
  });

  describe('registerServer', () => {
    it('should register a server successfully', async () => {
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      };

      const client = new MockMCPClient();

      const effect = registry.registerServer('github', config, client);
      await Effect.runPromise(effect);

      const retrievedClient = registry.getClient('github');
      expect(retrievedClient).toBe(client);
    });

    it('should reject duplicate server registration', async () => {
      const config: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };

      const client1 = new MockMCPClient();
      const client2 = new MockMCPClient();

      // Register first time - should succeed
      await Effect.runPromise(registry.registerServer('github', config, client1));

      // Register again with same ID - should fail
      const effect = registry.registerServer('github', config, client2);

      await expect(Effect.runPromise(effect)).rejects.toThrow('already registered');
    });

    it('should track server status', async () => {
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      const client = new MockMCPClient();
      await Effect.runPromise(registry.registerServer('test-server', config, client));

      const status = registry.getServerStatus('test-server');
      expect(status).toBe('connected');
    });
  });

  describe('getClient', () => {
    it('should return client for registered server', async () => {
      const config: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      const client = new MockMCPClient();
      await Effect.runPromise(registry.registerServer('filesystem', config, client));

      const retrieved = registry.getClient('filesystem');
      expect(retrieved).toBe(client);
    });

    it('should return undefined for unregistered server', () => {
      const client = registry.getClient('unknown-server');
      expect(client).toBeUndefined();
    });
  });

  describe('getRegisteredServers', () => {
    it('should return empty array when no servers registered', () => {
      const servers = registry.getRegisteredServers();
      expect(servers).toEqual([]);
    });

    it('should return all registered server IDs', async () => {
      const config1: MCPServerConfig = {
        id: 'github',
        transport: 'stdio',
        command: 'npx',
      };
      const config2: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('github', config1, new MockMCPClient()));
      await Effect.runPromise(registry.registerServer('filesystem', config2, new MockMCPClient()));

      const servers = registry.getRegisteredServers();
      expect(servers).toHaveLength(2);
      expect(servers).toContain('github');
      expect(servers).toContain('filesystem');
    });
  });

  describe('discoverTools', () => {
    it('should discover tools from registered server with namespace', async () => {
      const mockTools = [
        {
          name: 'create_issue',
          description: 'Create an issue',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'close_issue',
          description: 'Close an issue',
          inputSchema: { type: 'object' as const, properties: {} },
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

      expect(tools).toHaveLength(2);
      expect(tools[0].id).toBe('github/create_issue');
      expect(tools[1].id).toBe('github/close_issue');
    });

    it('should fail when discovering from unregistered server', async () => {
      const effect = registry.discoverTools('unknown-server');

      await expect(Effect.runPromise(effect)).rejects.toThrow('not found');
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

      const allTools = await Effect.runPromise(registry.discoverAllTools());

      expect(allTools.size).toBe(2);
      expect(allTools.get('github')).toHaveLength(1);
      expect(allTools.get('filesystem')).toHaveLength(1);
      expect(allTools.get('github')![0].id).toBe('github/create_issue');
      expect(allTools.get('filesystem')![0].id).toBe('filesystem/read_file');
    });
  });

  describe('removeServer', () => {
    it('should remove server and close client', async () => {
      const client = new MockMCPClient();
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));
      expect(registry.getClient('test-server')).toBe(client);
      expect(client.isConnected()).toBe(true);

      await Effect.runPromise(registry.removeServer('test-server'));

      expect(registry.getClient('test-server')).toBeUndefined();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should close all clients and clear registry', async () => {
      const client1 = new MockMCPClient();
      const client2 = new MockMCPClient();

      await Effect.runPromise(registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, client1));
      await Effect.runPromise(registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, client2));

      expect(client1.isConnected()).toBe(true);
      expect(client2.isConnected()).toBe(true);

      await Effect.runPromise(registry.shutdown());

      expect(client1.isConnected()).toBe(false);
      expect(client2.isConnected()).toBe(false);
      expect(registry.getRegisteredServers()).toEqual([]);
    });
  });

  describe('updateServerStatus', () => {
    it('should update server status', async () => {
      const client = new MockMCPClient();
      await Effect.runPromise(registry.registerServer('test', { id: 'test', transport: 'stdio', command: 'test' }, client));

      expect(registry.getServerStatus('test')).toBe('connected');

      registry.updateServerStatus('test', 'error');
      expect(registry.getServerStatus('test')).toBe('error');

      registry.updateServerStatus('test', 'disconnected');
      expect(registry.getServerStatus('test')).toBe('disconnected');
    });
  });
});
