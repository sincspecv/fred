import { Action } from '../intent/intent';
import { MCPServerConfig } from '../mcp/types';

/**
 * Supported AI platforms
 * This is a union type of all supported platforms, but the actual
 * list is dynamically determined by available @ai-sdk packages
 */
export type AIPlatform = 
  | 'openai' 
  | 'groq' 
  | 'anthropic' 
  | 'google' 
  | 'mistral' 
  | 'cohere' 
  | 'vercel' 
  | 'azure-openai' 
  | 'azure-anthropic' 
  | 'azure'
  | 'fireworks' 
  | 'xai' 
  | 'ollama' 
  | 'ai21' 
  | 'nvidia' 
  | 'bedrock' 
  | 'amazon-bedrock' 
  | 'cloudflare' 
  | 'elevenlabs' 
  | 'lepton' 
  | 'perplexity' 
  | 'replicate' 
  | 'together' 
  | 'upstash'
  | string; // Allow any string for extensibility

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  systemMessage: string;
  platform: AIPlatform;
  model: string; // Model identifier (e.g., 'gpt-4', 'llama-3.1-70b-versatile', 'claude-3-opus')
  tools?: string[]; // Array of tool IDs to assign to this agent
  temperature?: number; // Optional temperature setting
  maxTokens?: number; // Optional max tokens setting
  utterances?: string[]; // Phrases that trigger this agent directly (bypasses intent matching)
  mcpServers?: MCPServerConfig[]; // MCP servers to connect to for this agent
}

/**
 * Agent instance (created from config)
 */
export interface AgentInstance {
  id: string;
  config: AgentConfig;
  processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
}

/**
 * Message to send to an agent
 */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Agent response
 */
export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    toolId: string;
    args: Record<string, any>;
    result?: any;
  }>;
  handoff?: {
    type: 'handoff';
    agentId: string;
    message: string;
    context?: Record<string, any>;
  };
}

