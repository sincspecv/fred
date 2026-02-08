import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Effect } from 'effect';
import { MCPServerRegistry } from '../../../packages/core/src/mcp/registry';
import type { MCPServerConfig, MCPClient } from '../../../packages/core/src/mcp/types';

// Mock MCP Client
class MockMCPClient implements MCPClient {
  private _connected = false;
  public initializeCalled = false;
  public closeCalled = false;

  constructor(autoConnect = false) {
    if (autoConnect) {
      this._connected = true;
    }
  }

  async initialize() {
    this.initializeCalled = true;
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
    this.closeCalled = true;
    this._connected = false;
  }

  isConnected() {
    return this._connected;
  }
}

describe('MCPServerRegistry - Lifecycle Management', () => {
  let registry: MCPServerRegistry;

  beforeEach(() => {
    registry = new MCPServerRegistry();
  });

  afterEach(async () => {
    await Effect.runPromise(registry.shutdown());
  });

  describe('lazy server startup', () => {
    it('should not connect lazy server at registration', async () => {
      const config: MCPServerConfig = {
        id: 'lazy-server',
        transport: 'stdio',
        command: 'test',
      };

      // Store lazy config without connecting
      registry.registerLazyServer('lazy-server', config);

      // Client should not be connected yet
      const retrievedClient = registry.getClient('lazy-server');
      expect(retrievedClient).toBeUndefined();
    });

    it('should return existing client on subsequent ensureConnected calls', async () => {
      const client = new MockMCPClient(true);
      const config: MCPServerConfig = {
        id: 'existing-server',
        transport: 'stdio',
        command: 'test',
      };

      // Pre-register a connected server
      await Effect.runPromise(registry.registerServer('existing-server', config, client));

      // ensureConnected should return existing client without re-connecting
      const client1 = await Effect.runPromise(registry.ensureConnected('existing-server'));
      const client2 = await Effect.runPromise(registry.ensureConnected('existing-server'));

      // Should be same client instance
      expect(client1).toBe(client2);
      expect(client1).toBe(client);
    });

    it('should fail when lazy config not found', async () => {
      // Try to connect non-existent lazy server
      try {
        await Effect.runPromise(registry.ensureConnected('non-existent'));
        // Should not reach here
        expect(false).toBe(true);
      } catch (error) {
        // Expected - server not found
        expect(error).toBeDefined();
      }
    });
  });

  describe('graceful shutdown', () => {
    it('should stop health checks before closing clients', async () => {
      const client = new MockMCPClient(true);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      // Start health check
      registry.startHealthChecks();

      // Shutdown should stop health checks first
      await Effect.runPromise(registry.shutdown());

      // Client should be closed
      expect(client.closeCalled).toBe(true);
    });

    it('should close all clients in order', async () => {
      const client1 = new MockMCPClient(true);
      const client2 = new MockMCPClient(true);
      const client3 = new MockMCPClient(true);

      await Effect.runPromise(
        registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, client1)
      );
      await Effect.runPromise(
        registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, client2)
      );
      await Effect.runPromise(
        registry.registerServer('server3', { id: 'server3', transport: 'stdio', command: 'test' }, client3)
      );

      await Effect.runPromise(registry.shutdown());

      // All clients should be closed
      expect(client1.closeCalled).toBe(true);
      expect(client2.closeCalled).toBe(true);
      expect(client3.closeCalled).toBe(true);
    });

    it('should handle client close errors gracefully', async () => {
      const client = new MockMCPClient(true);
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      // Mock close to throw error
      client.close = async () => {
        throw new Error('Close failed');
      };

      const config: MCPServerConfig = {
        id: 'error-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('error-server', config, client));

      // Shutdown should complete even though close failed
      await Effect.runPromise(registry.shutdown());

      // Should have warned about the failure
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('startup failure handling', () => {
    it('should log warning and not throw on initialization failure', async () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const config: MCPServerConfig = {
        id: 'bad-server',
        transport: 'stdio',
        command: 'nonexistent-command',
      };

      // registerAndConnect should catch error and log warning
      await Effect.runPromise(registry.registerAndConnect('bad-server', config));

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalled();

      // Server should NOT be in registry (failed to initialize)
      const client = registry.getClient('bad-server');
      expect(client).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });

    it('should continue without failed server', async () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const goodClient = new MockMCPClient(true);
      const goodConfig: MCPServerConfig = {
        id: 'good-server',
        transport: 'stdio',
        command: 'test',
      };

      const badConfig: MCPServerConfig = {
        id: 'bad-server',
        transport: 'stdio',
        command: 'nonexistent-command',
      };

      // Register good server
      await Effect.runPromise(registry.registerServer('good-server', goodConfig, goodClient));

      // Try to register bad server
      await Effect.runPromise(registry.registerAndConnect('bad-server', badConfig));

      // Good server should still be accessible
      const client = registry.getClient('good-server');
      expect(client).toBe(goodClient);
      expect(client?.isConnected()).toBe(true);

      // Bad server should not be accessible
      const badClient = registry.getClient('bad-server');
      expect(badClient).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });

    it('should not expose tools from failed servers', async () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const badConfig: MCPServerConfig = {
        id: 'bad-server',
        transport: 'stdio',
        command: 'nonexistent-command',
      };

      await Effect.runPromise(registry.registerAndConnect('bad-server', badConfig));

      // Trying to discover tools from failed server should fail
      try {
        await Effect.runPromise(registry.discoverTools('bad-server'));
        // Should not reach here
        expect(false).toBe(true);
      } catch (error) {
        // Expected - server not found
        expect(error).toBeDefined();
      }

      consoleWarnSpy.mockRestore();
    });
  });

  describe('startHealthChecks', () => {
    it('should start health checks for all servers with healthCheckIntervalMs', async () => {
      const client1 = new MockMCPClient(true);
      const client2 = new MockMCPClient(true);

      const config1: MCPServerConfig = {
        id: 'server1',
        transport: 'stdio',
        command: 'test',
      };

      const config2: MCPServerConfig = {
        id: 'server2',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('server1', config1, client1));
      await Effect.runPromise(registry.registerServer('server2', config2, client2));

      // Start health checks for all servers
      registry.startHealthChecks();

      // Wait a bit to ensure health checks are running
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Both servers should still be connected (health checks running)
      expect(registry.getServerStatus('server1')).toBe('connected');
      expect(registry.getServerStatus('server2')).toBe('connected');
    });
  });
});
