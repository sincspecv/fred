import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Effect } from 'effect';
import { MCPHealthManager } from '../../../packages/core/src/mcp/health';
import { MCPServerRegistry } from '../../../packages/core/src/mcp/registry';
import type { MCPServerConfig, MCPClient } from '../../../packages/core/src/mcp/types';

// Mock MCP Client with controllable connection status
class MockMCPClient implements MCPClient {
  private _connected = true;
  private _initializeCalls = 0;

  constructor(connected = true) {
    this._connected = connected;
  }

  async initialize() {
    this._initializeCalls++;
    this._connected = true;
    return {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: 'mock', version: '1.0.0' },
    };
  }

  async listTools() {
    return [
      {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];
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

  // Test helpers
  disconnect() {
    this._connected = false;
  }

  getInitializeCalls() {
    return this._initializeCalls;
  }
}

describe('MCPHealthManager', () => {
  let healthManager: MCPHealthManager;
  let registry: MCPServerRegistry;

  beforeEach(() => {
    healthManager = new MCPHealthManager();
    registry = new MCPServerRegistry();
  });

  afterEach(async () => {
    // Clean up timers
    healthManager.stopAll();
    // Clean up registry
    await Effect.runPromise(registry.shutdown());
  });

  describe('startHealthCheck', () => {
    it('should start periodic health check at specified interval', async () => {
      const client = new MockMCPClient();
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      // Track health check executions
      let checkCount = 0;
      const originalGetClient = registry.getClient.bind(registry);
      registry.getClient = (id: string) => {
        checkCount++;
        return originalGetClient(id);
      };

      healthManager.startHealthCheck(registry, 'test-server', 100); // 100ms interval

      // Wait for multiple checks
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Should have fired at least 3 times (0ms, 100ms, 200ms, 300ms)
      expect(checkCount).toBeGreaterThanOrEqual(3);
    });

    it('should not trigger reconnect when client is connected', async () => {
      const client = new MockMCPClient(true); // Connected
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      healthManager.startHealthCheck(registry, 'test-server', 100);

      await new Promise((resolve) => setTimeout(resolve, 250));

      // Status should still be connected (no reconnect needed)
      expect(registry.getServerStatus('test-server')).toBe('connected');
    });

    it('should trigger reconnect when client is disconnected', async () => {
      const client = new MockMCPClient(true);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      healthManager.startHealthCheck(registry, 'test-server', 100);

      // Simulate connection loss
      client.disconnect();

      // Wait for health check to detect and reconnect
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should have attempted reconnect and called initialize
      expect(client.getInitializeCalls()).toBeGreaterThan(0);
    });
  });

  describe('stopHealthCheck', () => {
    it('should stop health check for specific server', async () => {
      const client = new MockMCPClient();
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      let checkCount = 0;
      const originalGetClient = registry.getClient.bind(registry);
      registry.getClient = (id: string) => {
        checkCount++;
        return originalGetClient(id);
      };

      healthManager.startHealthCheck(registry, 'test-server', 100);

      await new Promise((resolve) => setTimeout(resolve, 150));
      const checksBeforeStop = checkCount;

      healthManager.stopHealthCheck('test-server');

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check count should not increase after stop
      expect(checkCount).toBe(checksBeforeStop);
    });
  });

  describe('stopAll', () => {
    it('should stop all health checks', async () => {
      const client1 = new MockMCPClient();
      const client2 = new MockMCPClient();

      await Effect.runPromise(
        registry.registerServer('server1', { id: 'server1', transport: 'stdio', command: 'test' }, client1)
      );
      await Effect.runPromise(
        registry.registerServer('server2', { id: 'server2', transport: 'stdio', command: 'test' }, client2)
      );

      let check1Count = 0;
      let check2Count = 0;
      const originalGetClient = registry.getClient.bind(registry);
      registry.getClient = (id: string) => {
        if (id === 'server1') check1Count++;
        if (id === 'server2') check2Count++;
        return originalGetClient(id);
      };

      healthManager.startHealthCheck(registry, 'server1', 100);
      healthManager.startHealthCheck(registry, 'server2', 100);

      await new Promise((resolve) => setTimeout(resolve, 150));
      const checks1BeforeStop = check1Count;
      const checks2BeforeStop = check2Count;

      healthManager.stopAll();

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Neither count should increase after stopAll
      expect(check1Count).toBe(checks1BeforeStop);
      expect(check2Count).toBe(checks2BeforeStop);
    });
  });

  describe('reconnectServer', () => {
    it('should successfully reconnect on first attempt', async () => {
      const client = new MockMCPClient(false); // Start disconnected
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));
      registry.updateServerStatus('test-server', 'disconnected');

      const success = await healthManager.reconnectServer(registry, 'test-server', 3);

      expect(success).toBe(true);
      expect(registry.getServerStatus('test-server')).toBe('connected');
      expect(client.getInitializeCalls()).toBe(1);
    });

    it('should use exponential backoff (1s, 2s, 4s) on retries', async () => {
      const client = new MockMCPClient(false);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      // Mock initialize to fail twice, then succeed
      let attemptCount = 0;
      const originalInitialize = client.initialize.bind(client);
      client.initialize = async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error('Connection failed');
        }
        return originalInitialize();
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      const startTime = Date.now();
      const success = await healthManager.reconnectServer(registry, 'test-server', 3);
      const elapsed = Date.now() - startTime;

      expect(success).toBe(true);
      // Should have waited 1s + 2s = 3s minimum before success on third attempt
      expect(elapsed).toBeGreaterThanOrEqual(3000);
      expect(elapsed).toBeLessThan(4000); // Allow some margin
    });

    it('should fail after max retries and mark server as error', async () => {
      const client = new MockMCPClient(false);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      // Mock initialize to always fail
      client.initialize = async () => {
        throw new Error('Connection failed');
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      const success = await healthManager.reconnectServer(registry, 'test-server', 3);

      expect(success).toBe(false);
      expect(registry.getServerStatus('test-server')).toBe('error');
    });

    it('should re-discover tools after successful reconnect', async () => {
      const client = new MockMCPClient(false);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      // Track discoverTools calls
      let discoverCalled = false;
      const originalDiscoverTools = registry.discoverTools.bind(registry);
      registry.discoverTools = (serverId: string) => {
        discoverCalled = true;
        return originalDiscoverTools(serverId);
      };

      await healthManager.reconnectServer(registry, 'test-server', 3);

      expect(discoverCalled).toBe(true);
    });

    it('should stop health check after exhausting retries', async () => {
      const client = new MockMCPClient(false);
      const config: MCPServerConfig = {
        id: 'test-server',
        transport: 'stdio',
        command: 'test',
      };

      client.initialize = async () => {
        throw new Error('Connection failed');
      };

      await Effect.runPromise(registry.registerServer('test-server', config, client));

      healthManager.startHealthCheck(registry, 'test-server', 100);

      // Trigger disconnect to start reconnect attempts
      client.disconnect();

      // Wait for reconnect to exhaust retries
      await new Promise((resolve) => setTimeout(resolve, 8000)); // 1s + 2s + 4s + buffer

      // Health check should be stopped for this server
      expect(registry.getServerStatus('test-server')).toBe('error');
    });
  });
});
