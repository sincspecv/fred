import { Schema } from 'effect';

export const BUILTIN_TOOL_CAPABILITIES = [
  'read',
  'write',
  'admin',
  'external',
  'expensive',
  'destructive',
] as const;

export type BuiltinToolCapability = (typeof BUILTIN_TOOL_CAPABILITIES)[number];
export type ToolCapability = BuiltinToolCapability | (string & {});

export interface ToolCapabilityMetadata {
  inferred: ToolCapability[];
  manual: ToolCapability[];
}

/**
 * Tool schema metadata compatible with config-defined tools.
 */
export interface ToolSchemaMetadata {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
}

/**
 * Tool schema definition for programmatic tools.
 */
export interface ToolSchemaDefinition<Input, Output, Failure> {
  input: Schema.Schema<Input>;
  success: Schema.Schema<Output>;
  failure?: Schema.Schema<Failure>;
  metadata?: ToolSchemaMetadata;
}

/**
 * Tool definition backed by Effect Schema.
 */
export interface Tool<Input = unknown, Output = unknown, Failure = unknown> {
  id: string;
  name: string;
  description: string;
  capabilities?: ToolCapability[];
  capabilityMetadata?: ToolCapabilityMetadata;
  schema?: ToolSchemaDefinition<Input, Output, Failure>;
  execute: (args: Input) => Promise<Output> | Output;
  strict?: boolean;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}
