import { Schema } from 'effect';
import { Fred, AgentResponse, sanitizeError } from '@fancyrobot/fred';

/**
 * Request/response types
 */
export interface MessageRequest {
  message: string;
  options?: {
    useSemanticMatching?: boolean;
    semanticThreshold?: number;
  };
}

/**
 * Schema for validating MessageRequest
 */
export const MessageRequestSchema = Schema.Struct({
  message: Schema.String.pipe(Schema.maxLength(1_000_000)), // 1MB max
  options: Schema.optional(
    Schema.Struct({
      useSemanticMatching: Schema.optional(Schema.Boolean),
      semanticThreshold: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
    })
  ),
});

/**
 * Validate and decode a MessageRequest from unknown input
 * @throws Error if validation fails
 */
export function validateMessageRequest(input: unknown): MessageRequest {
  try {
    return Schema.decodeUnknownSync(MessageRequestSchema)(input);
  } catch (error) {
    throw new Error(`Invalid request: ${error instanceof Error ? error.message : 'validation failed'}`);
  }
}

export interface MessageResponse {
  success: boolean;
  data?: AgentResponse;
  error?: string;
}

export interface ListResponse<T> {
  success: boolean;
  data: T[];
  count: number;
}

/**
 * Request handlers for the server
 */
export class ServerHandlers {
  private framework: Fred;

  constructor(framework: Fred) {
    this.framework = framework;
  }

  /**
   * Handle POST /message - Process a user message
   */
  async handleMessage(req: MessageRequest): Promise<MessageResponse> {
    try {
      const response = await this.framework.processMessage(req.message, req.options);

      if (!response) {
        return {
          success: false,
          error: 'No intent matched for the given message',
        };
      }

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      // Sanitize error message to prevent information leakage
      const sanitized = sanitizeError(error, 'Message processing failed');
      return {
        success: false,
        error: sanitized.message,
      };
    }
  }

  /**
   * Handle GET /agents - List all agents
   */
  async handleListAgents(): Promise<ListResponse<any>> {
    const agents = this.framework.getAgents();
    return {
      success: true,
      data: agents.map(agent => ({
        id: agent.id,
        config: agent.config,
      })),
      count: agents.length,
    };
  }

  /**
   * Handle GET /intents - List all intents
   */
  async handleListIntents(): Promise<ListResponse<any>> {
    const intents = this.framework.getIntents();
    return {
      success: true,
      data: intents,
      count: intents.length,
    };
  }

  /**
   * Handle GET /tools - List all tools
   */
  async handleListTools(): Promise<ListResponse<any>> {
    const tools = this.framework.getTools();
    return {
      success: true,
      data: tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        schema: tool.schema?.metadata,
      })),
      count: tools.length,
    };
  }
}
