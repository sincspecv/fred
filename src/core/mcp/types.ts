/**
 * MCP (Model Context Protocol) types and interfaces
 */

/**
 * MCP transport type
 */
export type MCPTransport = 'stdio' | 'http' | 'sse';

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  id: string;                    // Unique identifier for this MCP server
  name?: string;                 // Optional display name
  transport: MCPTransport;
  
  // For stdio transport
  command?: string;              // Command to run (e.g., 'npx', 'node')
  args?: string[];               // Arguments (e.g., ['-m', '@modelcontextprotocol/server-filesystem'])
  env?: Record<string, string>;  // Environment variables
  
  // For HTTP/SSE transport
  url?: string;                  // Server URL
  headers?: Record<string, string>; // Optional headers
  
  // Optional configuration
  enabled?: boolean;             // Enable/disable this server (default: true)
  timeout?: number;              // Connection timeout in ms (default: 30000)
}

/**
 * MCP protocol message types (JSON-RPC 2.0)
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

/**
 * MCP initialization request parameters
 */
export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: {
      listChanged?: boolean;
    };
    sampling?: Record<string, any>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

/**
 * MCP initialization response
 */
export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: {
      listChanged?: boolean;
    };
    resources?: {
      subscribe?: boolean;
      listChanged?: boolean;
    };
    prompts?: {
      listChanged?: boolean;
    };
    sampling?: Record<string, any>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

/**
 * MCP tool definition
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

/**
 * MCP resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * MCP client interface
 */
export interface MCPClient {
  /**
   * Initialize the MCP session
   */
  initialize(): Promise<MCPInitializeResult>;
  
  /**
   * List available tools
   */
  listTools(): Promise<MCPToolDefinition[]>;
  
  /**
   * Call a tool
   */
  callTool(name: string, args: Record<string, any>): Promise<any>;
  
  /**
   * List available resources
   */
  listResources(): Promise<MCPResource[]>;
  
  /**
   * Read a resource
   */
  readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }>;
  
  /**
   * List available prompts
   */
  listPrompts(): Promise<MCPPrompt[]>;
  
  /**
   * Get a prompt template
   */
  getPrompt(name: string, args?: Record<string, any>): Promise<{ messages: Array<{ role: string; content: any }> }>;
  
  /**
   * Close the connection
   */
  close(): Promise<void>;
  
  /**
   * Check if client is connected
   */
  isConnected(): boolean;
}

/**
 * MCP transport interface
 */
export interface MCPTransportInterface {
  /**
   * Send a request and wait for response
   */
  sendRequest(request: MCPRequest): Promise<MCPResponse>;
  
  /**
   * Send a notification (no response expected)
   */
  sendNotification(notification: MCPNotification): Promise<void>;
  
  /**
   * Connect to the transport
   */
  connect(): Promise<void>;
  
  /**
   * Disconnect from the transport
   */
  disconnect(): Promise<void>;
  
  /**
   * Check if transport is connected
   */
  isConnected(): boolean;
  
  /**
   * Set up notification handler
   */
  onNotification(handler: (notification: MCPNotification) => void): void;
}
