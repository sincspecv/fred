import { Intent, Action } from './core/intent/intent';
import { IntentMatcher } from './core/intent/matcher';
import { IntentRouter } from './core/intent/router';
import { AgentConfig, AgentInstance, AgentResponse } from './core/agent/agent';
import { AgentManager } from './core/agent/manager';
import { Tool } from './core/tool/tool';
import { ToolRegistry } from './core/tool/registry';
import { AIProvider, ProviderConfig } from './core/platform/provider';
import { OpenAIProvider } from './core/platform/openai';
import { GroqProvider } from './core/platform/groq';
import { createDynamicProvider } from './core/platform/dynamic';
import { FrameworkConfig } from './config/types';
import { loadConfig, validateConfig, extractIntents, extractAgents } from './config/loader';
import { semanticMatch } from './utils/semantic';
import { ContextManager } from './core/context/manager';
import { CoreMessage, convertToCoreMessages } from 'ai';

/**
 * Fred - Main class for building AI agents
 */
export class Fred {
  private toolRegistry: ToolRegistry;
  private agentManager: AgentManager;
  private intentMatcher: IntentMatcher;
  private intentRouter: IntentRouter;
  private defaultAgentId?: string;
  private contextManager: ContextManager;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.agentManager = new AgentManager(this.toolRegistry);
    this.intentMatcher = new IntentMatcher();
    this.intentRouter = new IntentRouter(this.agentManager);
    this.contextManager = new ContextManager();
  }

  /**
   * Register an AI provider
   */
  registerProvider(platform: string, provider: AIProvider): void {
    this.agentManager.registerProvider(platform, provider);
  }

  /**
   * Use an AI provider (fluent API)
   * Accepts the same parameters as AI SDK providers for full compatibility
   * @param platform - Platform name ('openai', 'groq', 'anthropic', 'google', 'mistral', etc.)
   * @param config - Provider configuration (matches AI SDK provider options)
   * @param config.apiKey - API key for the provider
   * @param config.baseURL - Base URL for the API (useful for custom endpoints or proxies)
   * @param config.headers - Custom headers to include in requests
   * @param config.fetch - Custom fetch implementation
   * @param config.[key] - Additional provider-specific options
   * @returns The provider instance
   * @example
   * // Basic usage with API key
   * const groq = await fred.useProvider('groq', { apiKey: 'your-key' });
   * 
   * // With custom base URL
   * const openai = await fred.useProvider('openai', { 
   *   apiKey: 'your-key',
   *   baseURL: 'https://api.openai.com/v1'
   * });
   * 
   * // With custom headers
   * const anthropic = await fred.useProvider('anthropic', { 
   *   apiKey: 'your-key',
   *   headers: { 'X-Custom-Header': 'value' }
   * });
   * 
   * // With custom fetch
   * const google = await fred.useProvider('google', {
   *   apiKey: 'your-key',
   *   fetch: customFetchImplementation
   * });
   */
  async useProvider(platform: string, config?: ProviderConfig): Promise<AIProvider> {
    const platformLower = platform.toLowerCase();
    
    // Try built-in providers first for better performance
    let provider: AIProvider;
    
    switch (platformLower) {
      case 'openai':
        provider = new OpenAIProvider(config);
        break;
      case 'groq':
        provider = new GroqProvider(config);
        break;
      default:
        // Use dynamic provider loading for other platforms
        provider = await createDynamicProvider(platformLower, config);
        break;
    }
    
    // Register the provider
    this.registerProvider(platformLower, provider);
    
    // Return the provider instance
    return provider;
  }

  /**
   * Use a custom integration/plugin
   * This method is reserved for custom providers and integrations
   * @param name - Integration name
   * @param integration - Integration function or object
   * @returns The Fred instance for chaining
   * @example
   * fred.use('custom-logger', (fred) => {
   *   // Custom integration logic
   * });
   */
  use(name: string, integration: ((fred: Fred) => void) | any): Fred {
    // Store custom integrations for future use
    // This is a placeholder for extensibility
    // Users can implement their own integration logic here
    if (typeof integration === 'function') {
      integration(this);
    }
    return this;
  }

  /**
   * Register default providers (OpenAI and Groq)
   * For other providers, use the .useProvider() method
   */
  registerDefaultProviders(config?: {
    openai?: ProviderConfig;
    groq?: ProviderConfig;
    [key: string]: ProviderConfig | undefined;
  }): void {
    // @ts-ignore - Bun global
    const openaiKey = typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : undefined;
    // @ts-ignore - Bun global
    const groqKey = typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined;
    
    if (config?.openai || !openaiKey) {
      this.registerProvider('openai', new OpenAIProvider(config?.openai));
    } else {
      this.registerProvider('openai', new OpenAIProvider());
    }

    if (config?.groq || !groqKey) {
      this.registerProvider('groq', new GroqProvider(config?.groq));
    } else {
      this.registerProvider('groq', new GroqProvider());
    }
    
    // Register any additional providers from config
    for (const [platform, platformConfig] of Object.entries(config || {})) {
      if (platform !== 'openai' && platform !== 'groq' && platformConfig) {
        // Use dynamic provider for other platforms
        createDynamicProvider(platform, platformConfig).then(provider => {
          this.registerProvider(platform, provider);
        }).catch(() => {
          // Silently fail for optional providers
          // Users can use .useProvider() method for explicit provider registration
        });
      }
    }
  }

  /**
   * Register a tool
   */
  registerTool(tool: Tool): void {
    this.toolRegistry.registerTool(tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool[]): void {
    this.toolRegistry.registerTools(tools);
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): Tool | undefined {
    return this.toolRegistry.getTool(id);
  }

  /**
   * Register an intent
   */
  registerIntent(intent: Intent): void {
    this.intentMatcher.registerIntents([intent]);
  }

  /**
   * Register multiple intents
   */
  registerIntents(intents: Intent[]): void {
    this.intentMatcher.registerIntents(intents);
  }

  /**
   * Create an agent from configuration
   */
  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    return this.agentManager.createAgent(config);
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.agentManager.getAgent(id);
  }

  /**
   * Set the default agent (fallback for unmatched messages)
   */
  setDefaultAgent(agentId: string): void {
    if (!this.agentManager.hasAgent(agentId)) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }
    this.defaultAgentId = agentId;
    this.intentRouter.setDefaultAgent(agentId);
  }

  /**
   * Get the default agent ID
   */
  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  /**
   * Process a user message through the intent system
   */
  async processMessage(
    message: string,
    options?: {
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
      conversationId?: string;
    }
  ): Promise<AgentResponse | null> {
    const conversationId = options?.conversationId || this.contextManager.generateConversationId();
    const useSemantic = options?.useSemanticMatching ?? true;
    const threshold = options?.semanticThreshold ?? 0.6;

    // Get conversation history
    const history = await this.contextManager.getHistory(conversationId);
    
    // Convert history to AgentMessage format for agents
    const previousMessages = history
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));

    // Add user message to context
    const userMessage: CoreMessage = {
      role: 'user',
      content: message,
    };
    await this.contextManager.addMessage(conversationId, userMessage);

    // Create semantic matcher if enabled
    const semanticMatcher = useSemantic
      ? async (msg: string, utterances: string[]) => {
          return semanticMatch(msg, utterances, threshold);
        }
      : undefined;

    let response: AgentResponse;

    // Routing priority: 1. Agent utterances, 2. Intent matching, 3. Default agent
    // Check agent utterances first (direct routing)
    const agentMatch = await this.agentManager.matchAgentByUtterance(message, semanticMatcher);
    
    if (agentMatch) {
      // Route directly to matched agent
      const agent = this.agentManager.getAgent(agentMatch.agentId);
      if (agent) {
        response = await agent.processMessage(message, previousMessages);
      } else {
        // Agent not found, fall through to intent matching
        const match = await this.intentMatcher.matchIntent(message, semanticMatcher);
        if (match) {
          response = await this.intentRouter.routeIntent(match, message) as AgentResponse;
        } else if (this.defaultAgentId) {
          response = await this.intentRouter.routeToDefaultAgent(message, previousMessages) as AgentResponse;
        } else {
          return null;
        }
      }
    } else {
      // No agent utterance match, try intent matching
      const match = await this.intentMatcher.matchIntent(message, semanticMatcher);
      
      if (match) {
        // Route to matched intent's action
        response = await this.intentRouter.routeIntent(match, message) as AgentResponse;
      } else if (this.defaultAgentId) {
        // No intent matched - route to default agent
        response = await this.intentRouter.routeToDefaultAgent(message, previousMessages) as AgentResponse;
      } else {
        // No match and no default agent
        return null;
      }
    }

    // Process handoffs recursively (with max depth to prevent infinite loops)
    const maxHandoffDepth = 10;
    let handoffDepth = 0;
    let currentResponse = response;
    
    while (currentResponse.handoff && handoffDepth < maxHandoffDepth) {
      handoffDepth++;
      const handoff = currentResponse.handoff;
      
      // Get target agent
      const targetAgent = this.agentManager.getAgent(handoff.agentId);
      if (!targetAgent) {
        // Target agent not found, return current response
        break;
      }

      // Prepare handoff message (use provided message or original message)
      const handoffMessage = handoff.message || message;
      
      // Add context from handoff if provided
      const handoffContext = handoff.context ? `\n\nContext: ${JSON.stringify(handoff.context)}` : '';
      const messageWithContext = handoffMessage + handoffContext;

      // Process message with target agent
      currentResponse = await targetAgent.processMessage(messageWithContext, previousMessages);
    }

    if (handoffDepth >= maxHandoffDepth) {
      console.warn('Maximum handoff depth reached. Stopping handoff chain.');
    }

    // Add assistant response to context
    const assistantMessage: CoreMessage = {
      role: 'assistant',
      content: currentResponse.content,
    };
    await this.contextManager.addMessage(conversationId, assistantMessage);

    return currentResponse;
  }

  /**
   * Process OpenAI-compatible chat messages
   */
  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: {
      conversationId?: string;
      useSemanticMatching?: boolean;
      semanticThreshold?: number;
    }
  ): Promise<AgentResponse | null> {
    const conversationId = options?.conversationId || this.contextManager.generateConversationId();
    
    // Convert to AI SDK CoreMessage format
    const coreMessages = convertToCoreMessages(messages);
    
    // Get existing conversation history
    const existingHistory = await this.contextManager.getHistory(conversationId);
    
    // Merge with new messages (avoid duplicates)
    const allMessages: CoreMessage[] = [...existingHistory];
    for (const msg of coreMessages) {
      // Simple deduplication - in production, use better logic
      const lastMsg = allMessages[allMessages.length - 1];
      if (!lastMsg || lastMsg.role !== msg.role || lastMsg.content !== msg.content) {
        allMessages.push(msg);
      }
    }
    
    // Update context with all messages
    await this.contextManager.addMessages(conversationId, coreMessages);
    
    // Extract the last user message
    const lastUserMessage = coreMessages[coreMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);

    // Process through intent system
    const response = await this.processMessage(userMessageText, {
      conversationId,
      useSemanticMatching: options?.useSemanticMatching,
      semanticThreshold: options?.semanticThreshold,
    });

    return response;
  }

  /**
   * Get the context manager instance
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Initialize from a config file
   */
  async initializeFromConfig(
    configPath: string,
    options?: {
      toolExecutors?: Map<string, Tool['execute']>;
      providers?: {
        openai?: ProviderConfig;
        groq?: ProviderConfig;
      };
    }
  ): Promise<void> {
    // Load and validate config
    const config = loadConfig(configPath);
    validateConfig(config);

    // Register providers
    this.registerDefaultProviders(options?.providers);

    // Register tools (need execute functions)
    if (config.tools) {
      const toolExecutors = options?.toolExecutors || new Map();
      for (const toolDef of config.tools) {
        const executor = toolExecutors.get(toolDef.id);
        if (!executor) {
          throw new Error(
            `Tool "${toolDef.id}" requires an execute function. Provide it in toolExecutors option.`
          );
        }
        this.registerTool({
          ...toolDef,
          execute: executor,
        });
      }
    }

    // Register intents
    const intents = extractIntents(config);
    if (intents.length > 0) {
      this.registerIntents(intents);
    }

    // Create agents (resolve prompt files relative to config path)
    const agents = extractAgents(config, configPath);
    for (const agentConfig of agents) {
      await this.createAgent(agentConfig);
    }
  }

  /**
   * Get all registered intents
   */
  getIntents(): Intent[] {
    return this.intentMatcher.getIntents();
  }

  /**
   * Get all agents
   */
  getAgents(): AgentInstance[] {
    return this.agentManager.getAllAgents();
  }

  /**
   * Get all tools
   */
  getTools(): Tool[] {
    return this.toolRegistry.getAllTools();
  }
}

// Export all types and classes
export * from './core/intent/intent';
export * from './core/agent/agent';
export * from './core/tool/tool';
export * from './core/platform/provider';
export * from './core/platform/openai';
export * from './core/platform/groq';
export * from './config/types';
export { ToolRegistry } from './core/tool/registry';
export { AgentManager } from './core/agent/manager';
export { IntentMatcher } from './core/intent/matcher';
export { IntentRouter } from './core/intent/router';
export { ContextManager } from './core/context/manager';
export * from './core/context/context';

