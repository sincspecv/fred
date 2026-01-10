import {
  MCPClient,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolDefinition,
  MCPResource,
  MCPPrompt,
  MCPRequest,
  MCPNotification,
} from './types';
import { MCPTransportInterface } from './types';
import { StdioTransport } from './stdio-transport';
import { HttpTransport } from './http-transport';
import { MCPServerConfig } from './types';

/**
 * MCP client implementation
 * Handles communication with MCP servers using the MCP protocol
 */
export class MCPClientImpl implements MCPClient {
  private transport: MCPTransportInterface;
  private initialized = false;
  private serverInfo?: { name: string; version: string };
  private rootDirectories: string[] = [];

  constructor(config: MCPServerConfig) {
    // Validate config
    if (config.enabled === false) {
      throw new Error('MCP server is disabled');
    }

    // Create appropriate transport based on config
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error('stdio transport requires command');
      }
      this.transport = new StdioTransport(
        config.command,
        config.args || [],
        config.env
      );
    } else if (config.transport === 'http' || config.transport === 'sse') {
      if (!config.url) {
        throw new Error('http/sse transport requires url');
      }
      this.transport = new HttpTransport(
        config.url,
        config.headers,
        config.timeout || 30000
      );
    } else {
      throw new Error(`Unsupported transport: ${config.transport}`);
    }

    // Set up notification handler
    this.transport.onNotification((notification) => {
      // Handle notifications (e.g., tools/list_changed, resources/list_changed)
      // For now, we'll just log them
      console.debug('MCP notification:', notification);
    });

    // Set up server request handlers
    // Handle roots/list request (common after initialization)
    // The filesystem server expects root directories to be provided
    // Extract root directory from args if it's a filesystem server
    if (config.transport === 'stdio' && config.args && config.args.length > 0) {
      // The last argument is typically the root directory
      const rootDir = config.args[config.args.length - 1];
      // Check if it's a valid directory path (not a flag)
      if (rootDir && !rootDir.startsWith('-') && rootDir !== 'npx' && !rootDir.includes('@')) {
        this.rootDirectories = [rootDir];
      }
    }
    
    this.transport.onServerRequest('roots/list', async () => {
      // Return root directories for filesystem server
      return { roots: this.rootDirectories.map(path => ({ uri: `file://${path}` })) };
    });
  }

  async initialize(): Promise<MCPInitializeResult> {
    if (this.initialized) {
      throw new Error('Client already initialized');
    }

    // Connect transport with retry logic
    let lastError: Error | undefined;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.transport.connect();
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    if (!this.transport.isConnected()) {
      throw lastError || new Error('Failed to connect to MCP server');
    }

    // Send initialize request
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true,
          },
        },
        clientInfo: {
          name: 'fred',
          version: '0.1.2',
        },
      } as MCPInitializeParams,
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    const result = response.result as MCPInitializeResult;
    this.serverInfo = result.serverInfo;
    this.initialized = true;

    // Send initialized notification
    const notification: MCPNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await this.transport.sendNotification(notification);

    // Wait a moment for the server to process the initialized notification
    // and handle any server requests (like roots/list)
    // The server may send roots/list request which we handle asynchronously
    await new Promise(resolve => setTimeout(resolve, 1000));

    return result;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    await this.ensureInitialized();

    // Wait a bit to ensure server has processed any pending requests
    await new Promise(resolve => setTimeout(resolve, 500));

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'tools/list',
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`);
    }

    const result = response.result as { tools: MCPToolDefinition[] };
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    await this.ensureInitialized();

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`Call tool failed: ${response.error.message}`);
    }

    const result = response.result as { content: Array<{ type: string; text?: string; [key: string]: any }> };
    
    // Extract text content from result
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content
        .filter(item => item.type === 'text' && item.text)
        .map(item => item.text)
        .join('\n');
      
      if (textContent) {
        return textContent;
      }
      
      // If no text content, return the full result
      return result;
    }

    return result;
  }

  async listResources(): Promise<MCPResource[]> {
    await this.ensureInitialized();

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'resources/list',
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`List resources failed: ${response.error.message}`);
    }

    const result = response.result as { resources: MCPResource[] };
    return result.resources || [];
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    await this.ensureInitialized();

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'resources/read',
      params: {
        uri,
      },
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`Read resource failed: ${response.error.message}`);
    }

    return response.result as { contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> };
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    await this.ensureInitialized();

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'prompts/list',
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`List prompts failed: ${response.error.message}`);
    }

    const result = response.result as { prompts: MCPPrompt[] };
    return result.prompts || [];
  }

  async getPrompt(name: string, args?: Record<string, any>): Promise<{ messages: Array<{ role: string; content: any }> }> {
    await this.ensureInitialized();

    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'prompts/get',
      params: {
        name,
        arguments: args || {},
      },
    };

    const response = await this.transport.sendRequest(request);
    
    if (response.error) {
      throw new Error(`Get prompt failed: ${response.error.message}`);
    }

    return response.result as { messages: Array<{ role: string; content: any }> };
  }

  async close(): Promise<void> {
    await this.transport.disconnect();
    this.initialized = false;
  }

  isConnected(): boolean {
    return this.initialized && this.transport.isConnected();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private generateId(): number {
    return Date.now() + Math.random();
  }
}
