import { Schema } from 'effect';
import { ChatHandlers } from './handlers';
import { ChatCompletionRequest } from './chat';
import { sanitizeError } from '../../utils/validation';

/**
 * Schema for validating ChatMessage
 */
const ChatMessageSchema = Schema.Struct({
  role: Schema.Union(
    Schema.Literal('system'),
    Schema.Literal('user'),
    Schema.Literal('assistant'),
    Schema.Literal('tool')
  ),
  content: Schema.NullOr(Schema.String.pipe(Schema.maxLength(1_000_000))),
  name: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  tool_calls: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.Literal('tool_call'),
        tool_call: Schema.Struct({
          name: Schema.String.pipe(Schema.maxLength(256)),
          arguments: Schema.String.pipe(Schema.maxLength(100_000)),
        }),
      })
    )
  ),
  tool_call_id: Schema.optional(Schema.String),
});

/**
 * Schema for validating ChatCompletionRequest
 */
const ChatCompletionRequestSchema = Schema.Struct({
  model: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  messages: Schema.Array(ChatMessageSchema).pipe(Schema.maxItems(1000)),
  temperature: Schema.optional(Schema.Number.pipe(Schema.between(0, 2))),
  max_tokens: Schema.optional(Schema.Number.pipe(Schema.positive())),
  stream: Schema.optional(Schema.Boolean),
  conversation_id: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
});

/**
 * Schema for validating simplified chat request
 */
const SimpleChatRequestSchema = Schema.Struct({
  messages: Schema.optional(Schema.Array(ChatMessageSchema).pipe(Schema.maxItems(1000))),
  message: Schema.optional(Schema.String.pipe(Schema.maxLength(1_000_000))),
  conversation_id: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  stream: Schema.optional(Schema.Boolean),
});

/**
 * Validate and decode a ChatCompletionRequest from unknown input
 */
function validateChatCompletionRequest(input: unknown): ChatCompletionRequest {
  try {
    return Schema.decodeUnknownSync(ChatCompletionRequestSchema)(input) as ChatCompletionRequest;
  } catch (error) {
    throw new Error(`Invalid request: ${error instanceof Error ? error.message : 'validation failed'}`);
  }
}

/**
 * Validate and decode a simple chat request from unknown input
 */
function validateSimpleChatRequest(input: unknown): {
  messages?: any[];
  message?: string;
  conversation_id?: string;
  stream?: boolean;
} {
  try {
    return Schema.decodeUnknownSync(SimpleChatRequestSchema)(input);
  } catch (error) {
    throw new Error(`Invalid request: ${error instanceof Error ? error.message : 'validation failed'}`);
  }
}

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
      const rawBody = await request.json();
      // Validate request body against schema
      const body = validateChatCompletionRequest(rawBody);

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
      // Sanitize error message to prevent information leakage
      const sanitized = sanitizeError(error, 'Chat completion failed');
      return Response.json(
        {
          error: {
            message: sanitized.message,
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
      const rawBody = await request.json();
      // Validate request body against schema
      const body = validateSimpleChatRequest(rawBody);

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
      // Sanitize error message to prevent information leakage
      const sanitized = sanitizeError(error, 'Chat request failed');
      return Response.json(
        {
          success: false,
          error: sanitized.message,
        },
        { status: 500 }
      );
    }
  }
}

