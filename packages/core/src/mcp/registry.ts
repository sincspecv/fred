import { Effect } from 'effect';
import type { MCPClientImpl } from './client';
import { MCPClientImpl as MCPClientImplClass } from './client';
import type { MCPServerConfig } from './types';
import { convertMCPToolsToFredTools } from './adapter';
import type { Tool } from '../tool/tool';
import { MCPHealthManager } from './health';

/**
 * Server status states
 */
export type ServerStatus = 'connected' | 'disconnected' | 'error';

/**
 * Server registry entry
 */
interface ServerEntry {
  client: MCPClientImpl;
  config: MCPServerConfig;
  status: ServerStatus;
}

/**
 * Global registry for MCP servers with centralized lifecycle management.
 *
 * Provides:
 * - Server registration and deduplication
 * - Client retrieval by server ID
 * - Namespaced tool discovery
 * - Status tracking
 * - Lazy server startup
 * - Health check management
 * - Graceful shutdown of all servers
 */
export class MCPServerRegistry {
  private servers: Map<string, ServerEntry> = new Map();
  private lazyConfigs: Map<string, MCPServerConfig> = new Map();
  private healthManager: MCPHealthManager = new MCPHealthManager();

  /**
   * Register an MCP server with its client.
   *
   * @param id - Unique server identifier
   * @param config - Server configuration
   * @param client - Initialized MCP client
   * @returns Effect that completes when server is registered
   * @throws Error if server with same ID is already registered
   */
  registerServer(
    id: string,
    config: MCPServerConfig,
    client: MCPClientImpl
  ): Effect.Effect<void, Error> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      // Check for duplicate registration
      if (this.servers.has(id)) {
        return yield* Effect.fail(
          new Error(`MCP server '${id}' already registered`)
        );
      }

      // Register server
      this.servers.set(id, {
        client,
        config,
        status: 'connected',
      });
    }.bind(this));
  }

  /**
   * Get client for a registered server.
   *
   * @param id - Server identifier
   * @returns MCP client or undefined if not registered
   */
  getClient(id: string): MCPClientImpl | undefined {
    return this.servers.get(id)?.client;
  }

  /**
   * Get list of all registered server IDs.
   *
   * @returns Array of server IDs
   */
  getRegisteredServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get status of a registered server.
   *
   * @param id - Server identifier
   * @returns Server status or undefined if not registered
   */
  getServerStatus(id: string): ServerStatus | undefined {
    return this.servers.get(id)?.status;
  }

  /**
   * Update server status.
   *
   * @param id - Server identifier
   * @param status - New status
   */
  updateServerStatus(id: string, status: ServerStatus): void {
    const entry = this.servers.get(id);
    if (entry) {
      entry.status = status;
    }
  }

  /**
   * Discover tools from a specific server with namespace format.
   *
   * Tools are converted to Fred Tool format with IDs in `server/tool` format.
   *
   * @param serverId - Server identifier
   * @returns Effect providing array of namespaced Fred tools
   * @throws Error if server not found
   */
  discoverTools(serverId: string): Effect.Effect<Tool[], Error> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      const client = this.getClient(serverId);
      if (!client) {
        return yield* Effect.fail(
          new Error(`MCP server '${serverId}' not found`)
        );
      }

      const mcpTools = yield* Effect.tryPromise({
        try: () => client.listTools(),
        catch: (error) =>
          new Error(
            `Failed to discover tools from '${serverId}': ${error instanceof Error ? error.message : String(error)}`
          ),
      });

      return convertMCPToolsToFredTools(mcpTools, client, serverId);
    }.bind(this));
  }

  /**
   * Discover tools from all registered servers.
   *
   * Skips disconnected or error servers with warning logs.
   *
   * @returns Effect providing Map of server ID to tools array
   */
  discoverAllTools(): Effect.Effect<Map<string, Tool[]>, never> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      const serverIds = this.getRegisteredServers();
      const toolsMap = new Map<string, Tool[]>();

      for (const serverId of serverIds) {
        // Use Effect.either to catch errors without failing the whole operation
        const result = yield* Effect.either(this.discoverTools(serverId));

        if (result._tag === 'Right') {
          const tools = result.right;
          toolsMap.set(serverId, tools);
        } else {
          // Log warning but continue with other servers
          console.warn(
            `Skipping server '${serverId}' in discoverAllTools:`,
            result.left.message
          );
        }
      }

      return toolsMap;
    }.bind(this));
  }

  /**
   * Remove server and close its client.
   *
   * @param id - Server identifier
   * @returns Effect that completes when server is removed and client closed
   */
  removeServer(id: string): Effect.Effect<void> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      const entry = this.servers.get(id);
      if (entry) {
        // Only try to close if client exists (not null for error-state servers)
        if (entry.client) {
          // Use Effect.catchAll to suppress errors and just log warnings
          yield* Effect.tryPromise({
            try: () => entry.client.close(),
            catch: (error) =>
              new Error(
                `Failed to close MCP server '${id}': ${error instanceof Error ? error.message : String(error)}`
              ),
          }).pipe(
            Effect.catchAll((error) => {
              console.warn(error.message);
              return Effect.succeed(undefined);
            })
          );
        }
        this.servers.delete(id);
      }
    }.bind(this));
  }

  /**
   * Register a lazy server (deferred connection).
   *
   * Server will not connect until first getClient/ensureConnected call.
   *
   * @param id - Unique server identifier
   * @param config - Server configuration
   */
  registerLazyServer(id: string, config: MCPServerConfig): void {
    this.lazyConfigs.set(id, config);
  }

  /**
   * Ensure a lazy server is connected.
   *
   * If server is already connected, returns existing client.
   * If server is lazy and not connected, connects it.
   *
   * @param serverId - Server identifier
   * @returns Effect providing MCP client
   * @throws Error if connection fails
   */
  ensureConnected(serverId: string): Effect.Effect<MCPClientImpl, Error> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      // Check if already connected
      const existingClient = this.getClient(serverId);
      if (existingClient) {
        return existingClient;
      }

      // Check if lazy config exists
      const config = this.lazyConfigs.get(serverId);
      if (!config) {
        return yield* Effect.fail(
          new Error(`Server '${serverId}' not found in lazy configs`)
        );
      }

      // Create and initialize client
      const client = new MCPClientImplClass(config);
      yield* Effect.tryPromise({
        try: () => client.initialize(),
        catch: (error) => {
          console.warn(
            `Failed to connect lazy server '${serverId}':`,
            error instanceof Error ? error.message : String(error)
          );
          return new Error(
            `Failed to connect lazy server '${serverId}': ${error instanceof Error ? error.message : String(error)}`
          );
        },
      });

      // Register the connected client
      yield* this.registerServer(serverId, config, client);

      // Remove from lazy configs
      this.lazyConfigs.delete(serverId);

      return client;
    }.bind(this));
  }

  /**
   * Register and connect a server with graceful failure handling.
   *
   * On failure: logs warning, does not throw, server not added to registry.
   *
   * @param id - Server identifier
   * @param config - Server configuration
   * @returns Effect that always succeeds (never throws)
   */
  registerAndConnect(
    id: string,
    config: MCPServerConfig
  ): Effect.Effect<void, never> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      // Use Effect.either to catch all errors
      const registry = this; // Capture for inner scope
      const result = yield* Effect.either(
        Effect.gen(function* () {
          const client = new MCPClientImplClass(config);
          yield* Effect.tryPromise({
            try: () => client.initialize(),
            catch: (error) =>
              new Error(
                `MCP server '${id}' failed to initialize: ${error instanceof Error ? error.message : String(error)}`
              ),
          });

          // Register successfully initialized client
          yield* registry.registerServer(id, config, client);
        })
      );

      if (result._tag === 'Left') {
        // Graceful degradation - log warning but don't throw
        // Server is NOT added to registry
        console.warn(
          `MCP server '${id}' initialization failed - continuing without this server:`,
          result.left instanceof Error ? result.left.message : String(result.left)
        );
      }
    }.bind(this));
  }

  /**
   * Start health checks for all registered servers.
   *
   * Uses healthCheckIntervalMs from config, or defaults:
   * - 30000ms (30s) for stdio transport
   * - 60000ms (60s) for http/sse transport
   */
  startHealthChecks(): void {
    for (const [serverId, entry] of this.servers.entries()) {
      if (entry.status === 'connected') {
        // Determine interval from config or use defaults
        const config = entry.config;
        let intervalMs: number;

        if (config.transport === 'stdio') {
          intervalMs = 30000; // 30s for stdio
        } else {
          intervalMs = 60000; // 60s for http/sse
        }

        this.healthManager.startHealthCheck(this, serverId, intervalMs);
      }
    }
  }

  /**
   * Shutdown all servers and clear registry.
   *
   * Order:
   * 1. Stop all health checks
   * 2. Close all client connections
   * 3. Clear registry
   *
   * @returns Effect that completes when all servers are shutdown
   */
  shutdown(): Effect.Effect<void> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      // Step 1: Stop all health checks
      this.healthManager.stopAll();

      // Step 2: Close all clients
      const serverIds = Array.from(this.servers.keys());

      for (const id of serverIds) {
        yield* this.removeServer(id);
      }

      // Step 3: Clear registry
      this.servers.clear();
      this.lazyConfigs.clear();
    }.bind(this));
  }
}
