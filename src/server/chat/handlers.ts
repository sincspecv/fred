import { Fred } from '../../index';
import { ContextManager } from '../../core/context/manager';
import { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, ChatMessage } from './chat';
import { toOpenAIStream } from '../../core/stream/openai';
import { Stream } from 'effect';
import type { StreamEvent } from '../../core/stream/events';
import type { Prompt } from '@effect/ai';

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
    
    const modelMessages: Prompt.MessageEncoded[] = request.messages.map((msg) => ({
      role: msg.role as Prompt.MessageEncoded['role'],
      content: msg.content || '',
    }));
    
    // Get conversation history
    const history = await this.contextManager.getHistory(conversationId);
    
    // Combine history with new messages
    const allMessages: Prompt.MessageEncoded[] = [...history, ...modelMessages];
    
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
    const assistantMessage: Prompt.MessageEncoded = {
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
    
    const modelMessages: Prompt.MessageEncoded[] = request.messages.map((msg) => ({
      role: msg.role as Prompt.MessageEncoded['role'],
      content: msg.content || '',
    }));
    
    // Extract the last user message
    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);

    const stream = Stream.fromAsyncIterable(
      this.fred.streamMessage(userMessageText, {
        conversationId,
      }),
      (error) => error as Error
    );

    const openAIStream = toOpenAIStream(stream as Stream.Stream<StreamEvent>, {
      model: request.model ?? 'fred-agent',
    });

    let finalResponse: { content?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } = {};

    for await (const chunk of Stream.toAsyncIterable(openAIStream)) {
      yield chunk as ChatCompletionChunk;
      if ((chunk as any).object === 'chat.completion') {
        const completion = chunk as any;
        finalResponse = {
          content: completion.choices?.[0]?.message?.content ?? '',
          usage: completion.usage
            ? {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens,
              }
            : undefined,
        };
      }
    }

    if (finalResponse.content) {
      const assistantMessage: Prompt.MessageEncoded = {
        role: 'assistant',
        content: finalResponse.content,
      };
      await this.contextManager.addMessage(conversationId, assistantMessage);
    }
  }
}
