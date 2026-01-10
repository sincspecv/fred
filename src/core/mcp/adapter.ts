import { tool, jsonSchema } from 'ai';
import { Tool } from '../tool/tool';
import { MCPClient, MCPToolDefinition } from './types';

/**
 * Convert MCP tool to Fred Tool interface
 */
export function convertMCPToolToFredTool(
  mcpTool: MCPToolDefinition,
  mcpClient: MCPClient,
  serverId: string
): Tool {
  const toolId = `mcp-${serverId}-${mcpTool.name}`;
  
  return {
    id: toolId,
    name: toolId,
    description: mcpTool.description || '',
    parameters: {
      type: 'object',
      properties: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
    },
    execute: async (args: Record<string, any>) => {
      // Call MCP server's tools/call method
      const result = await mcpClient.callTool(mcpTool.name, args);
      return result;
    },
  };
}

/**
 * Convert MCP tool to AI SDK tool() format for use in generateText
 * This leverages the AI SDK's tool() and jsonSchema() functions
 */
export function createAISDKToolFromMCP(
  mcpTool: MCPToolDefinition,
  mcpClient: MCPClient,
  serverId: string
): ReturnType<typeof tool> {
  const fredTool = convertMCPToolToFredTool(mcpTool, mcpClient, serverId);
  
  // Use AI SDK's tool() and jsonSchema() - same pattern as factory.ts
  return tool({
    description: fredTool.description,
    parameters: jsonSchema(fredTool.parameters),
    execute: fredTool.execute,
  });
}

/**
 * Convert multiple MCP tools to AI SDK tools
 */
export function createAISDKToolsFromMCP(
  mcpTools: MCPToolDefinition[],
  mcpClient: MCPClient,
  serverId: string
): Record<string, ReturnType<typeof tool>> {
  const tools: Record<string, ReturnType<typeof tool>> = {};
  
  for (const mcpTool of mcpTools) {
    const toolId = `mcp-${serverId}-${mcpTool.name}`;
    tools[toolId] = createAISDKToolFromMCP(mcpTool, mcpClient, serverId);
  }
  
  return tools;
}

/**
 * Convert MCP tools to Fred Tool format (for registry)
 */
export function convertMCPToolsToFredTools(
  mcpTools: MCPToolDefinition[],
  mcpClient: MCPClient,
  serverId: string
): Tool[] {
  return mcpTools.map(tool => convertMCPToolToFredTool(tool, mcpClient, serverId));
}
