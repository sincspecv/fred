import { tool, jsonSchema } from 'ai';
import { Tool } from './tool';

/**
 * Normalize and convert a Fred Tool definition to an AI SDK tool
 * 
 * This function handles:
 * - JSON Schema detection and normalization
 * - Groq/provider compatibility (ensures type: "object", removes additionalProperties)
 * - Wrapping with jsonSchema() for AI SDK v6 compatibility
 * - Creating the AI SDK tool with inputSchema (v6 API)
 * 
 * @param toolDef - The Fred Tool definition
 * @param executeFn - The execute function to use (may be wrapped with tracing/timeout)
 * @returns An AI SDK tool ready for use with ToolLoopAgent
 */
export function convertToAISDKTool(
  toolDef: Tool,
  executeFn: (args: Record<string, any>) => Promise<any> | any
): ReturnType<typeof tool> {
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
  return tool({
    name: toolDef.name || toolDef.id, // Explicitly set tool name
    description: toolDef.description,
    inputSchema: wrappedSchema, // Use inputSchema for AI SDK v6 compatibility
    execute: executeFn,
    strict: toolDef.strict, // Enable strict validation if configured (AI SDK v6 feature)
  });
}
