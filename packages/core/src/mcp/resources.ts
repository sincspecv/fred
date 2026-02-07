import { Effect } from 'effect';
import type { MCPServerRegistry } from './registry';
import type { MCPResource } from './types';

/**
 * Resource content type
 */
export type ResourceContent = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
};

/**
 * Service for accessing MCP server resources.
 *
 * Provides:
 * - List resources from a specific server
 * - Read resource contents from a specific server
 * - List resources from all registered servers
 * - Graceful handling of disconnected servers
 */
export class MCPResourceService {
  constructor(private registry: MCPServerRegistry) {}

  /**
   * List resources from a specific server.
   *
   * @param serverId - Server identifier
   * @returns Effect providing array of resources
   * @throws Error if server not found
   */
  listResources(serverId: string): Effect.Effect<MCPResource[], Error> {
    return Effect.gen(function* (this: MCPResourceService) {
      const client = this.registry.getClient(serverId);
      if (!client) {
        return yield* Effect.fail(
          new Error(`MCP server '${serverId}' not found`)
        );
      }

      // Check if client is connected
      if (!client.isConnected()) {
        console.warn(`MCP server '${serverId}' is disconnected, returning empty resource list`);
        return [];
      }

      // List resources from the server
      try {
        const resources = yield* Effect.tryPromise({
          try: () => client.listResources(),
          catch: (error) => {
            console.warn(
              `Failed to list resources from '${serverId}':`,
              error instanceof Error ? error.message : String(error)
            );
            return new Error(
              `Failed to list resources from '${serverId}': ${error instanceof Error ? error.message : String(error)}`
            );
          },
        });

        return resources;
      } catch (error) {
        // If there's an error, log warning and return empty array
        console.warn(
          `Error listing resources from '${serverId}':`,
          error instanceof Error ? error.message : String(error)
        );
        return [];
      }
    }.bind(this));
  }

  /**
   * Read resource contents from a specific server.
   *
   * @param serverId - Server identifier
   * @param uri - Resource URI
   * @returns Effect providing resource contents
   * @throws Error if server not found or not connected
   */
  readResource(
    serverId: string,
    uri: string
  ): Effect.Effect<ResourceContent, Error> {
    return Effect.gen(function* (this: MCPResourceService) {
      const client = this.registry.getClient(serverId);
      if (!client) {
        return yield* Effect.fail(
          new Error(`MCP server '${serverId}' not found`)
        );
      }

      // Check if client is connected
      if (!client.isConnected()) {
        return yield* Effect.fail(
          new Error(`MCP server '${serverId}' is not connected`)
        );
      }

      // Read resource from the server
      const result = yield* Effect.tryPromise({
        try: () => client.readResource(uri),
        catch: (error) =>
          new Error(
            `Failed to read resource from '${serverId}': ${error instanceof Error ? error.message : String(error)}`
          ),
      });

      return result;
    }.bind(this));
  }

  /**
   * List resources from all registered servers.
   *
   * Skips disconnected or error servers with warning logs.
   *
   * @returns Effect providing Map of server ID to resources array
   */
  listAllResources(): Effect.Effect<Map<string, MCPResource[]>, never> {
    return Effect.gen(function* (this: MCPResourceService) {
      const serverIds = this.registry.getRegisteredServers();
      const resourcesMap = new Map<string, MCPResource[]>();

      for (const serverId of serverIds) {
        // Use Effect.either to catch errors without failing the whole operation
        const result = yield* Effect.either(this.listResources(serverId));

        if (result._tag === 'Right') {
          const resources = result.right;
          if (resources.length > 0) {
            resourcesMap.set(serverId, resources);
          }
        } else {
          // Log warning but continue with other servers
          console.warn(
            `Skipping server '${serverId}' in listAllResources:`,
            result.left.message
          );
        }
      }

      return resourcesMap;
    }.bind(this));
  }
}
