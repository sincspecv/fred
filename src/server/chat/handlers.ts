import { ModelMessage, convertToModelMessages } from 'ai';
import { Fred } from '../../index';
import { ContextManager } from '../../core/context/manager';
import { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, ChatMessage } from './chat';

/**
 * Chat API handlers
 */
export class ChatHandlers {
  private fred: Fred;
  private contextManager: ContextManager;

  constructor(fred: Fred, contextManager: ContextManager) {
    this.fred = fred;
    this.contextManager = contextManager;
  }

  /**
   * Handle chat completion request
   */
  async handleChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const conversationId = request.conversation_id || this.contextManager.generateConversationId();
    
    // Convert OpenAI messages to AI SDK ModelMessage format
    const openaiMessages: Array<{ role: string; content: string }> = request.messages.map(msg => ({
      role: msg.role,
      content: msg.content || '',
    }));

    const modelMessages = await convertToModelMessages(openaiMessages);
    
    // Get conversation history
    const history = await this.contextManager.getHistory(conversationId);
    
    // Combine history with new messages
    const allMessages: ModelMessage[] = [...history, ...modelMessages];
    
    // Extract the last user message
    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);

    // Process message through Fred
    const response = await this.fred.processMessage(userMessageText, {
      conversationId,
    });

    if (!response) {
      throw new Error('No response from agent');
    }

    // Add user message to context
    await this.contextManager.addMessage(conversationId, lastUserMessage);
    
    // Add assistant response to context
    const assistantMessage: ModelMessage = {
      role: 'assistant',
      content: response.content,
    };
    await this.contextManager.addMessage(conversationId, assistantMessage);

    // Build OpenAI-compatible response
    const chatResponse: ChatCompletionResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'fred-agent',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
          },
          finish_reason: 'stop',
        },
      ],
    };

    return chatResponse;
  }

  /**
   * Handle streaming chat completion
   * Returns an async generator for streaming responses
   */
  async *handleStreamingChat(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const conversationId = request.conversation_id || this.contextManager.generateConversationId();
    
    // Convert OpenAI messages to AI SDK ModelMessage format
    const openaiMessages: Array<{ role: string; content: string }> = request.messages.map(msg => ({
      role: msg.role,
      content: msg.content || '',
    }));

    const modelMessages = await convertToModelMessages(openaiMessages);
    
    // Get conversation history
    const history = await this.contextManager.getHistory(conversationId);
    
    // Extract the last user message
    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);

    // For streaming, we need to use the agent's streamText directly
    // This is a simplified version - full implementation would use streamText from AI SDK
    const response = await this.fred.processMessage(userMessageText, {
      conversationId,
    });

    if (!response) {
      throw new Error('No response from agent');
    }

    // Add messages to context
    await this.contextManager.addMessage(conversationId, lastUserMessage);
    
    const assistantMessage: ModelMessage = {
      role: 'assistant',
      content: response.content,
    };
    await this.contextManager.addMessage(conversationId, assistantMessage);

    // Stream response in chunks (simplified - would use actual streaming in production)
    const content = response.content;
    const chunkSize = 10;
    const id = `chatcmpl-${Date.now()}`;
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk: ChatCompletionChunk = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'fred-agent',
        choices: [
          {
            index: 0,
            delta: {
              content: content.substring(i, i + chunkSize),
            },
            finish_reason: i + chunkSize >= content.length ? 'stop' : null,
          },
        ],
      };
      yield chunk;
    }
  }
}

