import { Effect } from 'effect';
import type { MCPServerRegistry } from './registry';

/**
 * Health check and auto-restart manager for MCP servers.
 *
 * Provides:
 * - Periodic health checks at configurable intervals
 * - Auto-restart with exponential backoff on connection loss
 * - Tool re-discovery after successful reconnection
 */
export class MCPHealthManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private retryState: Map<string, { attempts: number; maxRetries: number }> =
    new Map();
  private reconnectInFlight: Map<string, Promise<boolean>> = new Map();

  /**
   * Start periodic health check for a server.
   *
   * Checks client.isConnected() at specified interval and triggers
   * reconnect if disconnected.
   *
   * @param registry - MCP server registry
   * @param serverId - Server identifier
   * @param intervalMs - Health check interval in milliseconds
   */
  startHealthCheck(
    registry: MCPServerRegistry,
    serverId: string,
    intervalMs: number
  ): void {
    // Stop any existing health check for this server
    this.stopHealthCheck(serverId);

    const timer = setInterval(async () => {
      const client = registry.getClient(serverId);
      if (!client) {
        // Server not registered, stop health check
        this.stopHealthCheck(serverId);
        return;
      }

      // Check connection status
      if (!client.isConnected()) {
        // Client disconnected, attempt reconnect
        await this.reconnectServer(registry, serverId);
      }
    }, intervalMs);

    this.timers.set(serverId, timer);
  }

  /**
   * Stop health check for a specific server.
   *
   * @param serverId - Server identifier
   */
  stopHealthCheck(serverId: string): void {
    const timer = this.timers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(serverId);
    }
  }

  /**
   * Stop all health checks.
   */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.retryState.clear();
    this.reconnectInFlight.clear();
  }

  /**
   * Attempt to reconnect a server with exponential backoff.
   *
   * Backoff schedule: 1s, 2s, 4s (configurable max retries)
   *
   * On success: Updates status to 'connected', re-discovers tools
   * On failure: Updates status to 'error', stops health check
   *
   * @param registry - MCP server registry
   * @param serverId - Server identifier
   * @param maxRetries - Maximum reconnection attempts (default: 3)
   * @returns Promise resolving to true if reconnect succeeded, false otherwise
   */
  async reconnectServer(
    registry: MCPServerRegistry,
    serverId: string,
    maxRetries: number = 3
  ): Promise<boolean> {
    const inFlight = this.reconnectInFlight.get(serverId);
    if (inFlight) {
      return inFlight;
    }

    const reconnectPromise = this.reconnectServerInternal(registry, serverId, maxRetries).finally(() => {
      this.reconnectInFlight.delete(serverId);
    });

    this.reconnectInFlight.set(serverId, reconnectPromise);
    return reconnectPromise;
  }

  private async reconnectServerInternal(
    registry: MCPServerRegistry,
    serverId: string,
    maxRetries: number
  ): Promise<boolean> {
    const client = registry.getClient(serverId);
    if (!client) {
      console.warn(`Cannot reconnect - server '${serverId}' not found`);
      return false;
    }

    // Initialize retry state if not exists
    if (!this.retryState.has(serverId)) {
      this.retryState.set(serverId, { attempts: 0, maxRetries });
    }

    const state = this.retryState.get(serverId)!;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      state.attempts = attempt + 1;

      try {
        // Try to reconnect (re-initialize client)
        await client.initialize();

        // Success - update status and re-discover tools
        registry.updateServerStatus(serverId, 'connected');

        // Re-discover tools after reconnection
        try {
          await Effect.runPromise(registry.discoverTools(serverId));
        } catch (error) {
          console.warn(
            `Failed to re-discover tools after reconnect for '${serverId}':`,
            error instanceof Error ? error.message : String(error)
          );
        }

        // Reset retry state on success
        this.retryState.delete(serverId);

        console.log(`Server '${serverId}' reconnected successfully`);
        return true;
      } catch (error) {
        const attemptNum = attempt + 1;
        console.warn(
          `Reconnect attempt ${attemptNum}/${maxRetries} failed for '${serverId}':`,
          error instanceof Error ? error.message : String(error)
        );

        // If not last attempt, wait with exponential backoff
        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          console.log(`Waiting ${backoffMs}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries exhausted - mark as error and stop health check
    registry.updateServerStatus(serverId, 'error');
    this.stopHealthCheck(serverId);
    this.retryState.delete(serverId);

    console.error(
      `Server '${serverId}' failed to reconnect after ${maxRetries} attempts`
    );
    return false;
  }
}
