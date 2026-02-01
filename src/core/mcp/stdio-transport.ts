import { spawn, ChildProcess } from 'child_process';
import { MCPTransportInterface, MCPRequest, MCPResponse, MCPNotification } from './types';

/**
 * MCP stdio transport implementation
 * Communicates with MCP servers via stdin/stdout
 */
export class StdioTransport implements MCPTransportInterface {
  private process?: ChildProcess;
  private pendingRequests: Map<string | number, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }> = new Map();
  private notificationHandlers: Array<(notification: MCPNotification) => void> = [];
  private serverRequestHandlers: Map<string, (params: any) => Promise<any> | any>;
  private requestIdCounter = 0;
  private command: string;
  private args: string[];
  private env?: Record<string, string>;
  private connected = false;

  // Track bound event handlers for cleanup
  private boundHandlers?: {
    onData: (data: Buffer) => void;
    onStderr: (data: Buffer) => void;
    onExit: (code: number | null) => void;
    onError: (error: Error) => void;
  };

  constructor(command: string, args: string[] = [], env?: Record<string, string>) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.serverRequestHandlers = new Map();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Merge environment variables
      const processEnv = { ...process.env, ...this.env };

      this.process = spawn(this.command, this.args, {
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdin || !this.process.stdout) {
        reject(new Error('Failed to create stdio streams'));
        return;
      }

      // Handle stdout - parse JSON-RPC messages
      // MCP uses JSON-RPC 2.0 over stdio with newline-delimited JSON
      let buffer = '';

      // Create bound handlers so we can remove them later
      const onData = (data: Buffer) => {
        const rawData = data.toString();
        buffer += rawData;
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            try {
              const message = JSON.parse(trimmed);
              this.handleMessage(message);
            } catch (error) {
              // Log parsing errors for debugging, but don't throw
              // Some lines might not be JSON (e.g., server startup messages)
              // Non-JSON lines (like server startup messages) - ignore silently
            }
          }
        }
      };

      const onStderr = (data: Buffer) => {
        console.error('MCP server stderr:', data.toString());
      };

      const onExit = (code: number | null) => {
        this.connected = false;
        // Only reject pending requests if exit code indicates an error (non-zero)
        if (code !== 0 && code !== null) {
          for (const [id, { reject, timeoutId }] of this.pendingRequests.entries()) {
            clearTimeout(timeoutId);
            reject(new Error(`MCP server exited with code ${code}`));
          }
          this.pendingRequests.clear();
        }
      };

      const onError = (error: Error) => {
        this.connected = false;
        reject(error);
      };

      // Store handlers for cleanup
      this.boundHandlers = { onData, onStderr, onExit, onError };

      // Attach handlers
      this.process.stdout.on('data', onData);
      this.process.stderr?.on('data', onStderr);
      this.process.on('exit', onExit);
      this.process.on('error', onError);

      // Wait for the process to be ready
      // The process should be ready once it's spawned
      // We'll mark as connected immediately, but the actual connection
      // will be established when we send the initialize request
      this.connected = true;
      resolve();
    });
  }

  async disconnect(): Promise<void> {
    // Remove event listeners before killing the process
    if (this.process && this.boundHandlers) {
      this.process.stdout?.off('data', this.boundHandlers.onData);
      this.process.stderr?.off('data', this.boundHandlers.onStderr);
      this.process.off('exit', this.boundHandlers.onExit);
      this.process.off('error', this.boundHandlers.onError);
      this.boundHandlers = undefined;
    }

    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }

    // Clear all pending request timeouts to prevent memory leaks
    for (const [id, { timeoutId }] of this.pendingRequests.entries()) {
      clearTimeout(timeoutId);
    }
    this.pendingRequests.clear();

    // Clear notification handlers
    this.notificationHandlers = [];

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.process !== undefined && !this.process.killed;
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    if (!this.isConnected() || !this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    return new Promise((resolve, reject) => {
      // Generate ID if not provided
      if (!request.id) {
        request.id = ++this.requestIdCounter;
      }

      // Set timeout (30 seconds default) and store the ID for cleanup
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      // Store pending request with timeout ID
      this.pendingRequests.set(request.id, { resolve, reject, timeoutId });

      // Send request
      const message = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(message, (error) => {
        if (error) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      });
    });
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    if (!this.isConnected() || !this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    const message = JSON.stringify(notification) + '\n';
    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  onNotification(handler: (notification: MCPNotification) => void): void {
    this.notificationHandlers.push(handler);
  }

  /**
   * Remove a notification handler
   */
  offNotification(handler: (notification: MCPNotification) => void): void {
    const index = this.notificationHandlers.indexOf(handler);
    if (index > -1) {
      this.notificationHandlers.splice(index, 1);
    }
  }

  /**
   * Register a handler for server requests
   */
  onServerRequest(method: string, handler: (params: any) => Promise<any> | any): void {
    this.serverRequestHandlers.set(method, handler);
  }

  private handleMessage(message: any): void {
    // Handle response (has id and either result or error)
    if ('id' in message && ('result' in message || 'error' in message)) {
      const response = message as MCPResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        // Clear the timeout to prevent memory leak
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`MCP error: ${response.error.message}`));
        } else {
          pending.resolve(response);
        }
      } else {
        // Response for a request we don't have pending (shouldn't happen, but log it)
        console.debug('Received response for unknown request ID:', response.id);
      }
    }
    // Handle notification (has method but no id)
    else if ('method' in message && !('id' in message)) {
      const notification = message as MCPNotification;
      for (const handler of this.notificationHandlers) {
        handler(notification);
      }
    }
    // Handle server requests (has method and id - server is requesting something from us)
    else if ('method' in message && 'id' in message && !('result' in message || 'error' in message)) {
      const serverRequest = message as MCPRequest;
      this.handleServerRequest(serverRequest).catch(error => {
        console.error('Error handling server request:', error);
      });
    }
    // Unknown message type
    else {
      console.debug('Received unknown message type:', message);
    }
  }

  private async handleServerRequest(request: MCPRequest): Promise<void> {
    const handler = this.serverRequestHandlers.get(request.method);
    
    if (handler) {
      try {
        const result = await Promise.resolve(handler(request.params || {}));
        // Send response to server
        const response: MCPResponse = {
          jsonrpc: '2.0',
          id: request.id,
          result,
        };
        if (this.process?.stdin) {
          const responseStr = JSON.stringify(response) + '\n';
          // Use write with callback to ensure it's sent
          return new Promise<void>((resolve, reject) => {
            this.process!.stdin!.write(responseStr, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      } catch (error) {
        // Send error response
        const response: MCPResponse = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        };
        if (this.process?.stdin) {
          return new Promise<void>((resolve, reject) => {
            this.process!.stdin!.write(JSON.stringify(response) + '\n', (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      }
    } else {
      // No handler - send method not found error
      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
      if (this.process?.stdin) {
        return new Promise<void>((resolve, reject) => {
          this.process!.stdin!.write(JSON.stringify(response) + '\n', (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    }
  }
}
