import { Schema } from 'effect';
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
    schema: {
      input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      success: Schema.Unknown,
      metadata: {
        type: 'object',
        properties: mcpTool.inputSchema.properties || {},
        required: mcpTool.inputSchema.required || [],
      },
    },
    execute: async (args: Record<string, any>) => {
      // Call MCP server's tools/call method
      const result = await mcpClient.callTool(mcpTool.name, args);
      return result;
    },
  };
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
