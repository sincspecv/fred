import { Effect } from 'effect';
import type { MCPClientImpl } from './client';
import type { MCPServerConfig } from './types';
import { convertMCPToolsToFredTools } from './adapter';
import type { Tool } from '../tool/tool';

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
 * - Graceful shutdown of all servers
 */
export class MCPServerRegistry {
  private servers: Map<string, ServerEntry> = new Map();

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
   * @returns Effect providing Map of server ID to tools array
   */
  discoverAllTools(): Effect.Effect<Map<string, Tool[]>, Error> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      const serverIds = this.getRegisteredServers();
      const toolsMap = new Map<string, Tool[]>();

      for (const serverId of serverIds) {
        const tools = yield* this.discoverTools(serverId);
        toolsMap.set(serverId, tools);
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
        yield* Effect.tryPromise({
          try: () => entry.client.close(),
          catch: (error) => {
            console.warn(
              `Failed to close MCP server '${id}':`,
              error instanceof Error ? error.message : String(error)
            );
            return Promise.resolve();
          },
        });
        this.servers.delete(id);
      }
    }.bind(this));
  }

  /**
   * Shutdown all servers and clear registry.
   *
   * Closes all client connections and clears the internal registry.
   *
   * @returns Effect that completes when all servers are shutdown
   */
  shutdown(): Effect.Effect<void> {
    return Effect.gen(function* (this: MCPServerRegistry) {
      const serverIds = Array.from(this.servers.keys());

      // Close all clients
      for (const id of serverIds) {
        yield* this.removeServer(id);
      }

      // Clear registry
      this.servers.clear();
    }.bind(this));
  }
}
