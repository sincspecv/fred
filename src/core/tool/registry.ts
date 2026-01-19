import { tool, jsonSchema } from 'ai';
import { Tool } from './tool';

/**
 * Centralized tool registry
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool in the registry
   */
  registerTool(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool with id "${tool.id}" is already registered`);
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /**
   * Get multiple tools by their IDs
   */
  getTools(ids: string[]): Tool[] {
    const tools: Tool[] = [];
    for (const id of ids) {
      const tool = this.getTool(id);
      if (tool) {
        tools.push(tool);
      }
    }
    return tools;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool exists
   */
  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * Remove a tool from the registry
   */
  removeTool(id: string): boolean {
    return this.tools.delete(id);
  }

  /**
   * Clear all tools from the registry
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the number of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Convert tools to Vercel AI SDK v6 format using tool() and jsonSchema()
   * This leverages the AI SDK's tool() and jsonSchema() functions for consistency
   * Uses inputSchema (AI SDK v6 API) instead of parameters (older API)
   */
  toAISDKTools(ids: string[]): Record<string, ReturnType<typeof tool>> {
    const tools = this.getTools(ids);
    const sdkTools: Record<string, ReturnType<typeof tool>> = {};

    for (const toolDef of tools) {
      // Check if parameters is already a JSON Schema object
      // If so, pass it directly to tool() - Groq provider handles it correctly
      // Only use jsonSchema() wrapper for Zod schemas or other non-JSON-Schema formats
      const isJSONSchema = toolDef.parameters && 
        typeof toolDef.parameters === 'object' && 
        !Array.isArray(toolDef.parameters) &&
        toolDef.parameters.type === 'object' && 
        toolDef.parameters.properties &&
        typeof toolDef.parameters.properties === 'object';
      
      let finalParams = toolDef.parameters;
      
      // For Groq and provider compatibility: Ensure schema has correct structure
      // Groq requires explicit type: "object" when properties are present
      // The AI SDK uses asSchema().jsonSchema to extract schemas, so we MUST use jsonSchema() wrapper
      // 
      // Note on additionalProperties:
      // - When omitted, JSON Schema defaults to permissive (allows extra properties)
      // - Some providers (including Groq) may have issues with explicit additionalProperties: false
      // - We remove additionalProperties to use default permissive behavior
      // - If strict validation is needed, use AI SDK v6's strict mode (strict: true on tool)
      // - Trade-off: Permissive schemas allow extra properties, which may be a security concern
      if (isJSONSchema) {
        // Ensure type is explicitly set to "object" (required by Groq and many providers)
        if (!finalParams.type || finalParams.type !== 'object') {
          finalParams = { ...finalParams, type: 'object' };
        }
        // Ensure properties exist and is an object (required for valid JSON Schema)
        if (!finalParams.properties || typeof finalParams.properties !== 'object') {
          throw new Error(`Tool "${toolDef.id}" has invalid schema: properties must be an object`);
        }
        // Remove additionalProperties to use default permissive behavior
        // This avoids potential provider compatibility issues while maintaining flexibility
        // For strict validation, use AI SDK v6's strict mode instead
        if ('additionalProperties' in finalParams) {
          const { additionalProperties, ...rest } = finalParams;
          finalParams = rest;
        }
      }
      
      // Always use jsonSchema() wrapper - AI SDK requires it to extract .jsonSchema property
      // The asSchema() function in AI SDK extracts tool.inputSchema.jsonSchema
      // Without jsonSchema() wrapper, the schema won't be extracted correctly
      const wrappedSchema = isJSONSchema ? jsonSchema(finalParams) : jsonSchema(toolDef.parameters);
      // AI SDK v6 uses inputSchema, not parameters
      // This is the correct way to define tool schemas in v6
      sdkTools[toolDef.id] = tool({
        name: toolDef.name || toolDef.id, // Explicitly set tool name
        description: toolDef.description,
        inputSchema: wrappedSchema, // Use inputSchema for AI SDK v6 compatibility
        execute: toolDef.execute,
        strict: toolDef.strict, // Enable strict validation if configured (AI SDK v6 feature)
      });
    }

    return sdkTools;
  }
}


