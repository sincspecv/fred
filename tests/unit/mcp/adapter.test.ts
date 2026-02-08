import { describe, it, expect } from 'bun:test';
import { convertMCPToolToFredTool, convertMCPToolsToFredTools } from '../../../packages/core/src/mcp/adapter';
import type { MCPToolDefinition, MCPClient } from '../../../packages/core/src/mcp/types';

// Mock MCP Client
const createMockMCPClient = (): MCPClient => ({
  initialize: async () => ({
    protocolVersion: '2024-11-05',
    capabilities: {},
    serverInfo: { name: 'test', version: '1.0.0' },
  }),
  listTools: async () => [],
  callTool: async (name: string, args: Record<string, any>) => ({ result: 'test' }),
  listResources: async () => [],
  readResource: async (uri: string) => ({ contents: [] }),
  listPrompts: async () => [],
  getPrompt: async (name: string, args?: Record<string, any>) => ({ messages: [] }),
  close: async () => {},
  isConnected: () => true,
});

describe('MCP Adapter - Namespace Format', () => {
  it('should use server/tool format for tool IDs', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'create_issue',
      description: 'Create a GitHub issue',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title', 'body'],
      },
    };

    const client = createMockMCPClient();
    const fredTool = convertMCPToolToFredTool(mcpTool, client, 'github');

    // EXPECTED: server/tool format (slash-separated)
    expect(fredTool.id).toBe('github/create_issue');
    expect(fredTool.name).toBe('github/create_issue');
  });

  it('should use server/tool format for different servers', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    };

    const client = createMockMCPClient();
    const fredTool = convertMCPToolToFredTool(mcpTool, client, 'filesystem');

    // EXPECTED: filesystem/read_file
    expect(fredTool.id).toBe('filesystem/read_file');
    expect(fredTool.name).toBe('filesystem/read_file');
  });

  it('should convert multiple tools with consistent namespace format', () => {
    const mcpTools: MCPToolDefinition[] = [
      {
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'close_issue',
        description: 'Close issue',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const client = createMockMCPClient();
    const fredTools = convertMCPToolsToFredTools(mcpTools, client, 'github');

    expect(fredTools).toHaveLength(2);
    expect(fredTools[0].id).toBe('github/create_issue');
    expect(fredTools[1].id).toBe('github/close_issue');
  });

  it('should preserve description and schema', () => {
    const mcpTool: MCPToolDefinition = {
      name: 'search',
      description: 'Search GitHub',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    };

    const client = createMockMCPClient();
    const fredTool = convertMCPToolToFredTool(mcpTool, client, 'github');

    expect(fredTool.description).toBe('Search GitHub');
    expect(fredTool.schema?.metadata?.properties).toEqual({ query: { type: 'string' } });
    expect(fredTool.schema?.metadata?.required).toEqual(['query']);
  });

  it('should create executable tools that call MCP client', async () => {
    const mcpTool: MCPToolDefinition = {
      name: 'test_tool',
      description: 'Test',
      inputSchema: { type: 'object', properties: {} },
    };

    const mockClient = createMockMCPClient();
    let capturedName: string | undefined;
    let capturedArgs: Record<string, any> | undefined;

    mockClient.callTool = async (name: string, args: Record<string, any>) => {
      capturedName = name;
      capturedArgs = args;
      return 'test result';
    };

    const fredTool = convertMCPToolToFredTool(mcpTool, mockClient, 'test-server');

    const result = await fredTool.execute({ foo: 'bar' });

    expect(capturedName).toBe('test_tool');
    expect(capturedArgs).toEqual({ foo: 'bar' });
    expect(result).toBe('test result');
  });
});
