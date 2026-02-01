import { sanitizeError } from '@fred/core';
import { ServerHandlers, validateMessageRequest } from './handlers';
import { ChatRoutes } from './chat/routes';

/**
 * Route handler type
 */
type RouteHandler = (request: Request) => Promise<Response>;

/**
 * Router for API routes
 */
export class Router {
  private handlers: ServerHandlers;
  private routes: Map<string, RouteHandler> = new Map();
  private chatRoutes?: ChatRoutes;

  constructor(handlers: ServerHandlers, chatRoutes?: ChatRoutes) {
    this.handlers = handlers;
    this.chatRoutes = chatRoutes;
    this.setupRoutes();
  }

  /**
   * Setup all routes
   */
  private setupRoutes(): void {
    // POST /message
    this.routes.set('POST /message', async (req) => {
      try {
        const body = await req.json();
        // Validate request body against schema
        const validatedBody = validateMessageRequest(body);
        const response = await this.handlers.handleMessage(validatedBody);
        return Response.json(response);
      } catch (error) {
        const sanitized = sanitizeError(error, 'Invalid request');
        return Response.json(
          { success: false, error: sanitized.message },
          { status: 400 }
        );
      }
    });

    // GET /agents
    this.routes.set('GET /agents', async () => {
      const response = await this.handlers.handleListAgents();
      return Response.json(response);
    });

    // GET /intents
    this.routes.set('GET /intents', async () => {
      const response = await this.handlers.handleListIntents();
      return Response.json(response);
    });

    // GET /tools
    this.routes.set('GET /tools', async () => {
      const response = await this.handlers.handleListTools();
      return Response.json(response);
    });

    // GET /health
    this.routes.set('GET /health', async () => {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Chat API routes (if chat routes are available)
    if (this.chatRoutes) {
      // POST /v1/chat/completions - OpenAI-compatible endpoint
      this.routes.set('POST /v1/chat/completions', async (req) => {
        return this.chatRoutes!.handleChatCompletions(req);
      });

      // POST /chat - Simplified chat endpoint
      this.routes.set('POST /chat', async (req) => {
        return this.chatRoutes!.handleChat(req);
      });
    }
  }

  /**
   * Handle a request
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // Try exact match first
    const routeKey = `${method} ${path}`;
    const handler = this.routes.get(routeKey);

    if (handler) {
      return handler(request);
    }

    // 404 for unmatched routes
    return Response.json(
      { success: false, error: 'Route not found' },
      { status: 404 }
    );
  }
}
