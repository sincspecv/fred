import { Schema } from 'effect';
import type { Tool, ToolSchemaDefinition } from '../tool/tool';
import { MCPClient, MCPToolDefinition } from './types';

/**
 * Convert MCP tool to Fred Tool interface
 */
export function convertMCPToolToFredTool(
  mcpTool: MCPToolDefinition,
  mcpClient: MCPClient,
  serverId: string
): Tool<Record<string, unknown>, unknown, never> {
  // Use server/tool namespace format (slash-separated)
  const toolId = `${serverId}/${mcpTool.name}`;

  // Create a properly typed schema for MCP tools
  const schema: ToolSchemaDefinition<Record<string, unknown>, unknown, never> = {
    input: Schema.Record({ key: Schema.String, value: Schema.Unknown }) as Schema.Schema<Record<string, unknown>>,
    success: Schema.Unknown,
    metadata: {
      type: 'object',
      properties: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
    },
  };

  return {
    id: toolId,
    name: toolId,
    description: mcpTool.description || '',
    schema,
    execute: async (args: Record<string, unknown>) => {
      try {
        // Check if client is connected before calling
        if (!mcpClient.isConnected()) {
          return `Tool ${toolId} failed: server disconnected`;
        }

        // Call MCP server's tools/call method
        const result = await mcpClient.callTool(mcpTool.name, args as Record<string, any>);
        return result;
      } catch (error) {
        // Return error message instead of throwing
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Tool ${toolId} failed: ${errorMessage}`;
      }
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
  return mcpTools.map(tool => convertMCPToolToFredTool(tool, mcpClient, serverId) as unknown as Tool);
}
