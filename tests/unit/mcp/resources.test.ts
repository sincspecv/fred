import { describe, it, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import { MCPResourceService } from '../../../packages/core/src/mcp/resources';
import { MCPServerRegistry } from '../../../packages/core/src/mcp/registry';
import type { MCPServerConfig, MCPClient, MCPResource } from '../../../packages/core/src/mcp/types';

// Mock MCP Client with controllable resource responses
class MockMCPClient implements MCPClient {
  private _connected = true;
  private _resources: MCPResource[] = [];
  private _resourceContents: Map<string, { uri: string; mimeType?: string; text?: string; blob?: string }[]> = new Map();

  constructor(resources: MCPResource[] = [], autoConnect = true) {
    this._resources = resources;
    this._connected = autoConnect;
  }

  setResourceContents(uri: string, contents: { uri: string; mimeType?: string; text?: string; blob?: string }[]) {
    this._resourceContents.set(uri, contents);
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
    return [];
  }

  async callTool(name: string, args: Record<string, any>) {
    return { result: `called ${name}` };
  }

  async listResources() {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    return this._resources;
  }

  async readResource(uri: string) {
    if (!this._connected) {
      throw new Error('Client not connected');
    }
    const contents = this._resourceContents.get(uri);
    if (!contents) {
      throw new Error(`Resource not found: ${uri}`);
    }
    return { contents };
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

describe('MCPResourceService', () => {
  let registry: MCPServerRegistry;
  let service: MCPResourceService;

  beforeEach(() => {
    registry = new MCPServerRegistry();
    service = new MCPResourceService(registry);
  });

  describe('listResources', () => {
    it('should list resources from a server', async () => {
      const mockResources: MCPResource[] = [
        { uri: 'file:///readme.md', name: 'README', description: 'Project readme' },
        { uri: 'file:///package.json', name: 'Package', description: 'Package config' },
      ];

      const client = new MockMCPClient(mockResources);
      const config: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('filesystem', config, client));

      const resources = await Effect.runPromise(service.listResources('filesystem'));

      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe('file:///readme.md');
      expect(resources[0].name).toBe('README');
      expect(resources[1].uri).toBe('file:///package.json');
    });

    it('should return empty array when server disconnected', async () => {
      const client = new MockMCPClient([]);
      const config: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('filesystem', config, client));

      // Disconnect the client
      client.disconnect();

      const resources = await Effect.runPromise(service.listResources('filesystem'));

      expect(resources).toEqual([]);
    });

    it('should fail when server not found', async () => {
      const effect = service.listResources('unknown-server');

      await expect(Effect.runPromise(effect)).rejects.toThrow('not found');
    });
  });

  describe('readResource', () => {
    it('should read resource contents from a server', async () => {
      const client = new MockMCPClient([]);
      client.setResourceContents('file:///readme.md', [
        { uri: 'file:///readme.md', mimeType: 'text/markdown', text: '# Hello World' },
      ]);

      const config: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('filesystem', config, client));

      const result = await Effect.runPromise(service.readResource('filesystem', 'file:///readme.md'));

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('file:///readme.md');
      expect(result.contents[0].text).toBe('# Hello World');
      expect(result.contents[0].mimeType).toBe('text/markdown');
    });

    it('should fail when server disconnected', async () => {
      const client = new MockMCPClient([]);
      const config: MCPServerConfig = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
      };

      await Effect.runPromise(registry.registerServer('filesystem', config, client));

      // Disconnect the client
      client.disconnect();

      const effect = service.readResource('filesystem', 'file:///readme.md');

      await expect(Effect.runPromise(effect)).rejects.toThrow('not connected');
    });

    it('should fail when server not found', async () => {
      const effect = service.readResource('unknown-server', 'file:///readme.md');

      await expect(Effect.runPromise(effect)).rejects.toThrow('not found');
    });
  });

  describe('listAllResources', () => {
    it('should aggregate resources from multiple servers', async () => {
      const fsResources: MCPResource[] = [
        { uri: 'file:///readme.md', name: 'README' },
      ];
      const githubResources: MCPResource[] = [
        { uri: 'github://repo/issues', name: 'Issues' },
        { uri: 'github://repo/prs', name: 'Pull Requests' },
      ];

      const fsClient = new MockMCPClient(fsResources);
      const githubClient = new MockMCPClient(githubResources);

      await Effect.runPromise(registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, fsClient));
      await Effect.runPromise(registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, githubClient));

      const allResources = await Effect.runPromise(service.listAllResources());

      expect(allResources.size).toBe(2);
      expect(allResources.get('filesystem')).toHaveLength(1);
      expect(allResources.get('github')).toHaveLength(2);
      expect(allResources.get('filesystem')![0].uri).toBe('file:///readme.md');
      expect(allResources.get('github')![0].uri).toBe('github://repo/issues');
    });

    it('should skip disconnected servers with warning', async () => {
      const fsClient = new MockMCPClient([{ uri: 'file:///readme.md', name: 'README' }]);
      const githubClient = new MockMCPClient([{ uri: 'github://repo/issues', name: 'Issues' }]);

      await Effect.runPromise(registry.registerServer('filesystem', { id: 'filesystem', transport: 'stdio', command: 'test' }, fsClient));
      await Effect.runPromise(registry.registerServer('github', { id: 'github', transport: 'stdio', command: 'test' }, githubClient));

      // Disconnect github client
      githubClient.disconnect();

      const allResources = await Effect.runPromise(service.listAllResources());

      // Should only get filesystem resources, github skipped due to disconnect
      expect(allResources.size).toBe(1);
      expect(allResources.get('filesystem')).toHaveLength(1);
      expect(allResources.has('github')).toBe(false);
    });

    it('should return empty map when no servers registered', async () => {
      const allResources = await Effect.runPromise(service.listAllResources());

      expect(allResources.size).toBe(0);
    });
  });
});
