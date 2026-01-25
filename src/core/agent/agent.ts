import { Action } from '../intent/intent';
import { MCPServerConfig } from '../mcp/types';
import type { ModelMessage } from '@effect/ai';
import type { Stream } from 'effect';
import type { StreamEvent } from '../stream/events';

/**
 * Supported AI platforms
 * This is a union type of all supported platforms, but the actual
 * list is dynamically determined by available provider packs
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
  systemMessage?: string;
  platform: AIPlatform;
  model: string; // Model identifier (e.g., 'gpt-4', 'llama-3.1-70b-versatile', 'claude-3-opus')
  tools?: string[]; // Array of tool IDs to assign to this agent
  temperature?: number; // Optional temperature setting
  maxTokens?: number; // Optional max tokens setting
  utterances?: string[]; // Phrases that trigger this agent directly (bypasses intent matching)
  mcpServers?: MCPServerConfig[]; // MCP servers to connect to for this agent
  maxSteps?: number; // Maximum number of steps in the agent loop (default: 20)
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool'; toolName: string }; // Control tool usage
  toolTimeout?: number; // Timeout for tool execution in milliseconds (default: 300000 = 5 minutes)
  persistHistory?: boolean; // Whether to persist conversation history for this agent (default: true)
}

/**
 * Agent instance (created from config)
 */
export interface AgentInstance {
  id: string;
  config: AgentConfig;
  processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
  streamMessage?: (
    message: string,
    messages?: AgentMessage[],
    options?: { threadId?: string }
  ) => Stream.Stream<StreamEvent>;
}

/**
 * Message to send to an agent
 * Aligned with Effect ModelMessage for type compatibility
 */
export type AgentMessage = ModelMessage;

/**
 * Agent response
 */
export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    toolId: string;
    args: Record<string, any>;
    result?: any;
    metadata?: Record<string, unknown>;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  handoff?: {
    type: 'handoff';
    agentId: string;
    message: string;
    context?: Record<string, any>;
  };
}
