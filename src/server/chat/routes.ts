import { ChatHandlers } from './handlers';
import { ChatCompletionRequest } from './chat';

/**
 * Chat API routes
 */
export class ChatRoutes {
  private handlers: ChatHandlers;

  constructor(handlers: ChatHandlers) {
    this.handlers = handlers;
  }

  /**
   * Handle POST /v1/chat/completions - OpenAI-compatible endpoint
   */
  async handleChatCompletions(request: Request): Promise<Response> {
    try {
      const body = await request.json() as ChatCompletionRequest;
      
      // Check if streaming is requested
      if (body.stream) {
        // Handle streaming response
        const stream = this.handlers.handleStreamingChat(body);
        
        // Create SSE stream
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                const data = `data: ${JSON.stringify(chunk)}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } else {
        // Handle non-streaming response
        const response = await this.handlers.handleChatCompletion(body);
        return Response.json(response);
      }
    } catch (error) {
      return Response.json(
        {
          error: {
            message: error instanceof Error ? error.message : 'Internal server error',
            type: 'invalid_request_error',
          },
        },
        { status: 400 }
      );
    }
  }

  /**
   * Handle POST /chat - Simplified chat endpoint
   */
  async handleChat(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { messages?: any[]; message?: string; conversation_id?: string; stream?: boolean };

      // Convert to ChatCompletionRequest format
      const chatRequest: ChatCompletionRequest = {
        messages: body.messages || [{ role: 'user', content: body.message || '' }],
        conversation_id: body.conversation_id,
        stream: body.stream || false,
      };

      if (chatRequest.stream) {
        const stream = this.handlers.handleStreamingChat(chatRequest);
        // TODO: Implement toDataStreamResponse or use alternative
        return new Response(JSON.stringify({ error: 'Streaming not fully implemented' }), { status: 501 });
      } else {
        const response = await this.handlers.handleChatCompletion(chatRequest);
        return Response.json(response);
      }
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error',
        },
        { status: 500 }
      );
    }
  }
}

