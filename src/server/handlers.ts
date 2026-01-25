import { Fred } from '../index';
import { AgentResponse } from '../core/agent/agent';

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
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
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
