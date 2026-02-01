/**
 * OpenAI-compatible chat API types
 */

/**
 * OpenAI chat message format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'tool_call';
    tool_call: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

/**
 * OpenAI chat completion request
 */
export interface ChatCompletionRequest {
  model?: string; // Not used in Fred, but required for OpenAI compatibility
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  conversation_id?: string; // Fred-specific: conversation ID for context
}

/**
 * OpenAI chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Streaming chat completion chunk
 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id: string;
        type: 'tool_call';
        tool_call: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
}
