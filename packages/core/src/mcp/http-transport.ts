import { MCPTransportInterface, MCPRequest, MCPResponse, MCPNotification } from './types';

/**
 * MCP HTTP/SSE transport implementation
 * Communicates with MCP servers via HTTP or Server-Sent Events
 */
export class HttpTransport implements MCPTransportInterface {
  private url: string;
  private headers?: Record<string, string>;
  private pendingRequests: Map<string | number, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private notificationHandlers: Array<(notification: MCPNotification) => void> = [];
  private requestIdCounter = 0;
  private connected = false;
  private timeout: number;

  constructor(url: string, headers?: Record<string, string>, timeout?: number) {
    this.url = url;
    this.headers = headers;
    this.timeout = timeout || 30000;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // For HTTP transport, we just mark as connected (requests are made on-demand)
    // For full SSE support, we would need to set up EventSource or similar
    // This implementation uses HTTP POST for all requests
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests.entries()) {
      reject(new Error('Transport disconnected'));
    }
    this.pendingRequests.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    if (!this.isConnected()) {
      throw new Error('Transport not connected');
    }

    // Generate ID if not provided
    if (!request.id) {
      request.id = ++this.requestIdCounter;
    }

    return new Promise((resolve, reject) => {
      // Store pending request
      this.pendingRequests.set(request.id, { resolve, reject });

      // Make HTTP POST request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
        .then(async (response) => {
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
          }
          const result = await response.json() as MCPResponse;
          
          // Handle response
          const pending = this.pendingRequests.get(result.id);
          if (pending) {
            this.pendingRequests.delete(result.id);
            if (result.error) {
              pending.reject(new Error(`MCP error: ${result.error.message}`));
            } else {
              pending.resolve(result);
            }
          } else {
            // Response for a request we don't have pending (shouldn't happen)
            if (result.error) {
              reject(new Error(`MCP error: ${result.error.message}`));
            } else {
              resolve(result);
            }
          }
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(request.id);
          if (error.name === 'AbortError') {
            reject(new Error('Request timeout'));
          } else {
            reject(error);
          }
        });
    });
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Transport not connected');
    }

    // Send notification via HTTP POST (fire and forget)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(notification),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name !== 'AbortError') {
        throw error;
      }
      // Ignore timeout for notifications (fire and forget)
    }
  }

  onNotification(handler: (notification: MCPNotification) => void): void {
    this.notificationHandlers.push(handler);
    // For SSE, we'd set up EventSource here to receive notifications
    // This is a simplified HTTP-only implementation
    // Full SSE support would require EventSource polyfill or native support
  }
}
