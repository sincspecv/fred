/**
 * Tool parameter definition
 */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: (string | number)[];
  properties?: Record<string, ToolParameter>; // For object types
  items?: ToolParameter; // For array types
}

/**
 * Tool definition compatible with Vercel AI SDK
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  execute: (args: Record<string, any>) => Promise<any> | any;
  strict?: boolean; // Enable strict validation (AI SDK v6 feature) - only defined properties allowed
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}


