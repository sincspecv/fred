import { generateText, tool, CoreMessage, jsonSchema } from 'ai';
import { AgentConfig, AgentMessage, AgentResponse } from './agent';
import { AIProvider } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { createHandoffTool, HandoffResult } from '../tool/handoff';
import { loadPromptFile } from '../../utils/prompt-loader';
import { MCPClientImpl, createAISDKToolsFromMCP, convertMCPToolsToFredTools } from '../mcp';

/**
 * Agent factory using Vercel AI SDK
 */
export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map(); // Track MCP clients per agent

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Set handoff handler for agent-to-agent handoffs
   */
  setHandoffHandler(handler: { getAgent: (id: string) => any; getAvailableAgents: () => string[] }): void {
    this.handoffHandler = handler;
  }

  /**
   * Create an agent instance from configuration
   */
  async createAgent(
    config: AgentConfig,
    provider: AIProvider
  ): Promise<{
    processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
  }> {
    const model = provider.getModel(config.model);
    
    // Get tools for this agent
    const tools = config.tools ? this.toolRegistry.getTools(config.tools) : [];
    
    // Auto-register handoff tool if handler is available
    if (this.handoffHandler) {
      const handoffTool = createHandoffTool(
        this.handoffHandler.getAgent,
        this.handoffHandler.getAvailableAgents
      );
      tools.push(handoffTool);
    }
    
    // Initialize MCP servers and discover tools
    const mcpTools: Record<string, any> = {};
    const mcpClientInstances: MCPClientImpl[] = [];
    
    if (config.mcpServers && config.mcpServers.length > 0) {
      for (const mcpConfig of config.mcpServers) {
        // Skip disabled servers
        if (mcpConfig.enabled === false) {
          continue;
        }

        try {
          // Create and initialize MCP client
          const mcpClient = new MCPClientImpl(mcpConfig);
          await mcpClient.initialize();
          mcpClientInstances.push(mcpClient);
          
          // Store client for cleanup later
          const clientKey = `${config.id}-${mcpConfig.id}`;
          this.mcpClients.set(clientKey, mcpClient);
          
          // Discover tools from MCP server
          const discoveredTools = await mcpClient.listTools();
          
          // Convert MCP tools to AI SDK format
          const aiSdkTools = createAISDKToolsFromMCP(discoveredTools, mcpClient, mcpConfig.id);
          Object.assign(mcpTools, aiSdkTools);
          
          // Also register MCP tools in the tool registry (for consistency)
          const fredTools = convertMCPToolsToFredTools(discoveredTools, mcpClient, mcpConfig.id);
          for (const fredTool of fredTools) {
            // Only register if not already registered (avoid conflicts)
            if (!this.toolRegistry.hasTool(fredTool.id)) {
              this.toolRegistry.registerTool(fredTool);
            }
          }
        } catch (error) {
          // Log error but don't fail agent creation
          console.error(`Failed to initialize MCP server "${mcpConfig.id}":`, error);
          // Continue with other MCP servers
        }
      }
    }
    
    // Convert regular tools to AI SDK format
    const sdkTools: Record<string, any> = {};
    for (const toolDef of tools) {
      sdkTools[toolDef.id] = tool({
        description: toolDef.description,
        parameters: jsonSchema(toolDef.parameters),
        execute: toolDef.execute,
      });
    }
    
    // Merge MCP tools with regular tools
    Object.assign(sdkTools, mcpTools);

    // Create the agent processing function
    const processMessage = async (
      message: string,
      previousMessages: AgentMessage[] = []
    ): Promise<AgentResponse> => {
      // Convert previous messages to AI SDK CoreMessage format
      const messages: CoreMessage[] = previousMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Load system message (handle file paths for programmatic usage)
      // Note: When loaded from config, paths are already resolved in extractAgents
      const systemMessage = loadPromptFile(config.systemMessage);

      // Generate response using AI SDK
      const allMessages: CoreMessage[] = [
        ...messages,
        { role: 'user', content: message },
      ];
      
      const result = await generateText({
        model,
        system: systemMessage,
        messages: allMessages,
        tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });

      // Extract tool calls if any
      const toolCalls = result.toolCalls?.map(tc => ({
        toolId: tc.toolName,
        args: tc.args as Record<string, any>,
        result: tc.result,
      }));

      // Check for handoff tool calls
      const handoffCall = toolCalls?.find(tc => tc.toolId === 'handoff_to_agent');
      if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result && handoffCall.result.type === 'handoff') {
        // Return handoff result - will be processed by message pipeline
        return {
          content: result.text,
          toolCalls,
          handoff: handoffCall.result as HandoffResult,
        } as AgentResponse & { handoff?: HandoffResult };
      }

      return {
        content: result.text,
        toolCalls,
      };
    };

    return { processMessage };
  }
}


