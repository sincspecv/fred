import { Fred } from '../index';
import { ServerHandlers } from './handlers';
import { Router } from './routes';
import { ChatRoutes } from './chat/routes';
import { ChatHandlers } from './chat/handlers';
import { sanitizeError } from '../utils/validation';

/**
 * HTTP server application
 */
export class ServerApp {
  private framework: Fred;
  private handlers: ServerHandlers;
  private router: Router;
  private chatRoutes: ChatRoutes;
  private server: any;

  constructor(framework: Fred) {
    this.framework = framework;
    this.handlers = new ServerHandlers(framework);
    
    // Initialize chat routes
    const contextManager = framework.getContextManager();
    const chatHandlers = new ChatHandlers(framework, contextManager);
    this.chatRoutes = new ChatRoutes(chatHandlers);
    
    this.router = new Router(this.handlers, this.chatRoutes);
  }

  /**
   * Start the HTTP server
   */
  async start(port: number = 3000, hostname: string = '0.0.0.0'): Promise<void> {
    this.server = Bun.serve({
      port,
      hostname,
      fetch: async (req) => {
        // Handle CORS
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          });
        }

        try {
          const response = await this.router.handleRequest(req);

          // Add CORS headers to response
          response.headers.set('Access-Control-Allow-Origin', '*');
          response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

          return response;
        } catch (error) {
          // Sanitize error message to prevent information leakage
          const sanitized = sanitizeError(error, 'Request failed');
          return Response.json(
            {
              success: false,
              error: sanitized.message,
            },
            { status: 500 }
          );
        }
      },
    });

    console.log(`Server running on http://${hostname}:${port}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    console.log('HTTP server stopped');
  }

  /**
   * Get the framework instance
   */
  getFramework(): Fred {
    return this.framework;
  }
}

