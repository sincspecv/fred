import { Effect, Scope } from 'effect';
import { MCPClientImpl } from './client';
import type { MCPServerConfig } from './types';

/**
 * Acquire MCP client with Effect-managed lifecycle using acquireRelease pattern.
 *
 * Acquire phase: Creates client and initializes connection
 * Release phase: Gracefully closes connection
 *
 * @param config - MCP server configuration
 * @returns Effect that provides an MCP client with automatic cleanup
 */
export const acquireMCPClient = (
  config: MCPServerConfig
): Effect.Effect<MCPClientImpl, Error, Scope.Scope> =>
  Effect.acquireRelease(
    // Acquire: create and initialize client
    Effect.gen(function* () {
      const client = new MCPClientImpl(config);
      yield* Effect.tryPromise({
        try: () => client.initialize(),
        catch: (error) =>
          new Error(
            `MCP server '${config.id}' failed to initialize: ${error instanceof Error ? error.message : String(error)}`
          ),
      });
      return client;
    }),
    // Release: gracefully close connection
    (client) =>
      Effect.tryPromise({
        try: () => client.close(),
        catch: (error) =>
          new Error(
            `Failed to close MCP client '${config.id}': ${error instanceof Error ? error.message : String(error)}`
          ),
      }).pipe(
        Effect.catchAll((error) => {
          // Log error but don't fail release - best effort cleanup
          console.warn(error.message);
          return Effect.succeed(undefined);
        })
      )
  );
