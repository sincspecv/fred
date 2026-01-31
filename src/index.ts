import { Intent } from './core/intent/intent';
import { IntentMatcher, createIntentMatcherSync } from './core/intent/matcher';
import { IntentRouter, createIntentRouterSync } from './core/intent/router';
import { AgentConfig, AgentInstance, AgentResponse, AgentMessage } from './core/agent/agent';
import { AgentManager } from './core/agent/manager';
import { PipelineConfig, PipelineInstance } from './core/pipeline';
import { PipelineManager, ResumeResult } from './core/pipeline/manager';
import type { PendingPause, HumanInputResumeOptions } from './core/pipeline/pause/types';
import { Tool } from './core/tool/tool';
import { ToolRegistry } from './core/tool/registry';
import { createCalculatorTool } from './core/tool/calculator';
import {
  ProviderConfig,
  ProviderConfigInput,
  ProviderDefinition,
} from './core/platform/provider';
import type { EffectProviderFactory } from './core/platform/base';
import { ProviderRegistry } from './core/platform/registry';
import { ContextManager } from './core/context/manager';
import { HookManager, HookType, HookHandler } from './core/hooks';
import { Tracer } from './core/tracing';
import { NoOpTracer } from './core/tracing/noop-tracer';
import { Effect, Runtime, Layer, Exit } from 'effect';
import type { StreamEvent } from './core/stream/events';
import type { StreamResult } from './core/stream/result';
import { MessageRouter } from './core/routing/router';
import { RoutingConfig, RoutingDecision } from './core/routing/types';
import { WorkflowManager } from './core/workflow/manager';
import { Workflow } from './core/workflow/types';
import { buildObservabilityLayers, type ObservabilityLayers } from './core/observability/otel';
import type { ObservabilityConfig } from './config/types';
import {
  GlobalVariablesService,
  GlobalVariablesServiceLive,
  type VariableFactory,
} from './core/variables';
import { ProviderService } from './core/provider/service';
import { MessageProcessor } from './core/message-processor/processor';
import type { ProcessingOptions, MemoryDefaults } from './core/message-processor/types';
import { ConfigInitializer, type FredLike } from './core/config/initializer';
import {
  FredLayers,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
} from './core/services';

/**
 * Fred - Main class for building AI agents
 *
 * Fred can be instantiated in two ways:
 *
 * 1. Async factory (recommended for new code):
 * ```typescript
 * const fred = await Fred.create();
 * ```
 *
 * 2. Constructor (backward compatible, lazy runtime initialization):
 * ```typescript
 * const fred = new Fred();
 * // Runtime initialized on first use
 * ```
 *
 * Internally, Fred uses Effect services for concurrency-safe operations.
 * The public API remains Promise-based for ease of use.
 */
export class Fred implements FredLike {
  private toolRegistry: ToolRegistry;
  private agentManager: AgentManager;
  private providerRegistry: ProviderRegistry;
  private pipelineManager: PipelineManager;
  private intentMatcher: IntentMatcher;
  private intentRouter: IntentRouter;
  private defaultAgentId?: string;
  private contextManager: ContextManager;
  private memoryDefaults: MemoryDefaults = {};
  private hookManager: HookManager;
  private tracer?: Tracer;
  private messageRouter?: MessageRouter;
  private workflowManager?: WorkflowManager;
  private observabilityLayers?: ObservabilityLayers;
  private globalVariables: Map<string, VariableFactory> = new Map();

  // Extracted services
  private providerService: ProviderService;
  private messageProcessor: MessageProcessor;
  private configInitializer: ConfigInitializer;

  // Effect runtime for service execution (lazy initialized)
  private runtime: FredRuntime | null = null;
  private runtimePromise: Promise<FredRuntime> | null = null;

  /**
   * Create a new Fred instance with initialized Effect runtime.
   *
   * This is the recommended way to create Fred instances as it
   * ensures all Effect services are ready before use.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * const agent = await fred.createAgent(config);
   * ```
   */
  static async create(tracer?: Tracer): Promise<Fred> {
    const fred = new Fred(tracer);
    await fred.ensureRuntime();
    return fred;
  }

  constructor(tracer?: Tracer) {
    this.toolRegistry = new ToolRegistry();
    this.tracer = tracer;
    this.providerRegistry = new ProviderRegistry();
    this.agentManager = new AgentManager(this.toolRegistry, tracer);
    this.intentMatcher = createIntentMatcherSync();
    this.intentRouter = createIntentRouterSync(this.agentManager);
    this.contextManager = new ContextManager();
    this.pipelineManager = new PipelineManager(this.agentManager, tracer, this.contextManager);
    this.hookManager = new HookManager();

    // Initialize extracted services
    this.providerService = new ProviderService(this.providerRegistry, this.agentManager);
    this.messageProcessor = new MessageProcessor({
      contextManager: this.contextManager,
      agentManager: this.agentManager,
      pipelineManager: this.pipelineManager,
      intentMatcher: this.intentMatcher,
      intentRouter: this.intentRouter,
      tracer: this.tracer,
      messageRouter: this.messageRouter,
      memoryDefaults: this.memoryDefaults,
      defaultAgentId: this.defaultAgentId,
    });
    this.configInitializer = new ConfigInitializer();

    // Set tracer on hook manager if provided
    if (this.tracer) {
      this.hookManager.setTracer(this.tracer);
    }

    // Register built-in tools
    this.registerBuiltInTools();

    // Register shutdown hooks for MCP client cleanup
    this.agentManager.registerShutdownHooks();

    // Deprecation warning for direct construction
    // Only warn in development to avoid noise in production
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[Fred] Deprecation: new Fred() is deprecated for long-running apps. ' +
        'Use Fred.create() for proper Effect runtime initialization. ' +
        'See: https://fred.dev/docs/migration/v0.2.5'
      );
    }
  }

  /**
   * Ensure Effect runtime is initialized (lazy initialization).
   *
   * This is called automatically by runEffect methods.
   * Call explicitly via Fred.create() for eager initialization.
   */
  private async ensureRuntime(): Promise<FredRuntime> {
    if (this.runtime) return this.runtime;

    if (!this.runtimePromise) {
      this.runtimePromise = Effect.runPromise(
        Effect.scoped(Layer.toRuntime(FredLayers))
      );
    }

    this.runtime = await this.runtimePromise;
    return this.runtime;
  }

  /**
   * Run an Effect with the Fred runtime.
   *
   * Wraps Effect errors as standard Error with cause for debugging.
   *
   * @internal
   */
  private async runEffect<A, E>(
    effect: Effect.Effect<A, E, FredServices>,
    errorMessage: string
  ): Promise<A> {
    const runtime = await this.ensureRuntime();
    try {
      return await Runtime.runPromise(runtime)(effect);
    } catch (error) {
      // Wrap Effect error as standard Error with cause
      throw new Error(errorMessage, { cause: error });
    }
  }

  /**
   * Run an Effect that can fail, returning null on failure.
   *
   * @internal
   */
  private async runEffectOptional<A, E>(
    effect: Effect.Effect<A, E, FredServices>
  ): Promise<A | null> {
    const runtime = await this.ensureRuntime();
    const exit = await Runtime.runPromiseExit(runtime)(effect);
    return Exit.match(exit, {
      onFailure: () => null,
      onSuccess: (value) => value,
    });
  }

  /**
   * Get the Effect runtime for advanced use cases.
   *
   * Power users can use this to run custom Effects with Fred services.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * const runtime = await fred.getRuntime();
   *
   * const result = await Runtime.runPromise(runtime)(
   *   Effect.gen(function* () {
   *     const toolService = yield* ToolRegistryService;
   *     return yield* toolService.size();
   *   })
   * );
   * ```
   */
  async getRuntime(): Promise<FredRuntime> {
    return this.ensureRuntime();
  }

  /**
   * Register built-in tools that are available by default
   */
  private registerBuiltInTools(): void {
    const calculatorTool = createCalculatorTool();
    // Cast to Tool for registry compatibility (registry uses Tool<unknown, unknown, unknown>)
    this.toolRegistry.registerTool(calculatorTool as unknown as Tool);
  }

  /**
   * Enable tracing with a tracer instance
   */
  enableTracing(tracer?: Tracer): void {
    this.tracer = tracer || new NoOpTracer();
    this.agentManager.setTracer(this.tracer);
    this.pipelineManager.setTracer(this.tracer);
    this.pipelineManager.setContextManager(this.contextManager);
    this.hookManager.setTracer(this.tracer);
    this.messageProcessor.updateDeps({ tracer: this.tracer });
  }

  // --- Global Variables ---

  async registerGlobalVariable(name: string, factory: VariableFactory): Promise<void> {
    this.globalVariables.set(name, factory);
    this.updateGlobalVariablesResolver();
  }

  async registerGlobalVariables(variables: Record<string, VariableFactory>): Promise<void> {
    for (const [name, factory] of Object.entries(variables)) {
      this.globalVariables.set(name, factory);
    }
    this.updateGlobalVariablesResolver();
  }

  async getGlobalVariable(name: string): Promise<string | number | boolean | undefined> {
    const factory = this.globalVariables.get(name);
    if (!factory) return undefined;
    return Effect.runPromise(factory());
  }

  async getGlobalVariables(): Promise<Record<string, string | number | boolean>> {
    const result: Record<string, string | number | boolean> = {};
    for (const [name, factory] of this.globalVariables.entries()) {
      result[name] = await Effect.runPromise(factory());
    }
    return result;
  }

  private updateGlobalVariablesResolver(): void {
    this.agentManager.setGlobalVariablesResolver(() => {
      const result: Record<string, string | number | boolean> = {};
      for (const [name, factory] of this.globalVariables.entries()) {
        result[name] = Effect.runSync(factory());
      }
      return result;
    });
  }

  // --- Provider Management (delegated to ProviderService) ---

  registerProvider(platform: string, provider: ProviderDefinition): void {
    this.providerService.registerProvider(platform, provider);
  }

  listProviders(): string[] {
    return this.providerService.listProviders();
  }

  hasProvider(providerId: string): boolean {
    return this.providerService.hasProvider(providerId);
  }

  async useProvider(platform: string, config?: ProviderConfig): Promise<ProviderDefinition> {
    return this.providerService.useProvider(platform, config);
  }

  async registerProviderPack(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    return this.providerService.registerProviderPack(idOrPackage, config);
  }

  async registerProviderFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    return this.providerService.registerProviderFactory(factory, config);
  }

  async registerDefaultProviders(config?: ProviderConfigInput): Promise<void> {
    return this.providerService.registerDefaultProviders(config);
  }

  /**
   * Use a custom integration/plugin
   */
  use(name: string, integration: ((fred: Fred) => void) | unknown): Fred {
    if (typeof integration === 'function') {
      (integration as (fred: Fred) => void)(this);
    }
    return this;
  }

  // --- Tool Management ---

  registerTool(tool: Tool): void {
    this.toolRegistry.registerTool(tool);
  }

  registerTools(tools: Tool[]): void {
    this.toolRegistry.registerTools(tools);
  }

  getTool(id: string): Tool | undefined {
    return this.toolRegistry.getTool(id);
  }

  getTools(): Tool[] {
    return this.toolRegistry.getAllTools();
  }

  // --- Intent Management ---

  registerIntent(intent: Intent): void {
    this.intentMatcher.registerIntents([intent]);
  }

  registerIntents(intents: Intent[]): void {
    this.intentMatcher.registerIntents(intents);
  }

  getIntents(): Intent[] {
    return this.intentMatcher.getIntents();
  }

  // --- Agent Management ---

  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    return this.agentManager.createAgent(config);
  }

  getAgent(id: string): AgentInstance | undefined {
    return this.agentManager.getAgent(id);
  }

  getAgents(): AgentInstance[] {
    return this.agentManager.getAllAgents();
  }

  setDefaultAgent(agentId: string): void {
    if (!this.agentManager.hasAgent(agentId)) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }
    this.defaultAgentId = agentId;
    this.intentRouter.setDefaultAgent(agentId);
    this.messageProcessor.updateDeps({ defaultAgentId: agentId });
  }

  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  // --- Pipeline Management ---

  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    return this.pipelineManager.createPipeline(config);
  }

  getPipeline(id: string): PipelineInstance | undefined {
    return this.pipelineManager.getPipeline(id);
  }

  getAllPipelines(): PipelineInstance[] {
    return this.pipelineManager.getAllPipelines();
  }

  removePipeline(id: string): boolean {
    return this.pipelineManager.removePipeline(id);
  }

  // --- Routing Configuration ---

  configureRouting(config: RoutingConfig): void {
    this.messageRouter = new MessageRouter(this.agentManager, this.hookManager, config);
    this.messageProcessor.updateDeps({ messageRouter: this.messageRouter });
  }

  async testRoute(message: string, metadata?: Record<string, unknown>): Promise<RoutingDecision | null> {
    if (!this.messageRouter) return null;
    return Effect.runPromise(this.messageRouter.testRoute(message, metadata ?? {}));
  }

  // --- Workflow Configuration ---

  configureWorkflows(workflows: Workflow[]): void {
    this.workflowManager = new WorkflowManager(this);
    for (const workflow of workflows) {
      this.workflowManager.addWorkflow(workflow.name, {
        defaultAgent: workflow.defaultAgent,
        agents: workflow.agents,
        routing: workflow.routing,
      });
    }
  }

  getWorkflowManager(): WorkflowManager | undefined {
    return this.workflowManager;
  }

  // --- Message Processing (delegated to MessageProcessor) ---

  async processMessage(message: string, options?: ProcessingOptions): Promise<AgentResponse | null> {
    return this.messageProcessor.processMessage(message, options);
  }

  streamMessage(message: string, options?: ProcessingOptions): StreamResult {
    return this.messageProcessor.streamMessage(message, options);
  }

  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    return this.messageProcessor.processChatMessage(messages, options);
  }

  // --- Context Management ---

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  // --- Hook Management ---

  registerHook(type: HookType, handler: HookHandler): void {
    this.hookManager.registerHook(type, handler);
  }

  unregisterHook(type: HookType, handler: HookHandler): boolean {
    return this.hookManager.unregisterHook(type, handler);
  }

  getHookManager(): HookManager {
    return this.hookManager;
  }

  // --- Pause/Resume Management ---

  async getPendingPause(runId: string): Promise<PendingPause | null> {
    const pauseManager = this.pipelineManager.getPauseManager();
    if (!pauseManager) return null;
    return pauseManager.getPendingPause(runId);
  }

  async listPendingPauses(): Promise<PendingPause[]> {
    const pauseManager = this.pipelineManager.getPauseManager();
    if (!pauseManager) return [];
    return pauseManager.listPendingPauses();
  }

  async resume(runId: string, options: HumanInputResumeOptions): Promise<ResumeResult> {
    return this.pipelineManager.resumeWithHumanInput(runId, options);
  }

  // --- Observability ---

  configureObservability(config: ObservabilityConfig): void {
    this.observabilityLayers = buildObservabilityLayers(config);
  }

  getObservabilityLayers(): ObservabilityLayers | undefined {
    return this.observabilityLayers;
  }

  // --- Config Initialization (delegated to ConfigInitializer) ---

  async initializeFromConfig(
    configPath: string,
    options?: {
      toolExecutors?: Map<string, Tool['execute']>;
      providers?: ProviderConfigInput;
    }
  ): Promise<void> {
    // Get memory defaults before initialization
    const memoryDefaults = this.configInitializer.getMemoryDefaults(configPath);
    this.memoryDefaults = memoryDefaults;
    this.messageProcessor.updateDeps({ memoryDefaults });

    // Delegate to config initializer
    await this.configInitializer.initialize(this, configPath, options);
  }

  // --- Accessor methods for FredLike interface ---

  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  getPipelineManager(): PipelineManager {
    return this.pipelineManager;
  }

  getProviderRegistry(): ProviderRegistry {
    return this.providerRegistry;
  }

  getProviderService(): ProviderService {
    return this.providerService;
  }

  /**
   * Shutdown Fred and release all resources.
   *
   * This closes database connections, MCP clients, and other resources.
   * Call this when your application exits.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * // ... use fred ...
   * await fred.shutdown();
   * ```
   */
  async shutdown(): Promise<void> {
    // Cleanup existing class-based resources
    await this.agentManager.clear();

    // Runtime cleanup happens automatically via Effect.scoped
    // when the runtime was created. Reset state for potential reuse.
    this.runtime = null;
    this.runtimePromise = null;
  }
}

// Re-export all types and classes
export * from './exports';

// Re-export StreamResult types
export type { StreamResult, TokenUsage, StreamStatus, ToolCallInfo } from './core/stream/result';

// Re-export Effect services for advanced users
export {
  FredLayers,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  MessageProcessorServiceLive,
} from './core/services';

// Re-export MessageProcessor error types
export type {
  MessageProcessorError,
  MessageValidationError,
  NoRouteFoundError,
  RouteExecutionError,
  HandoffError,
  ConversationIdRequiredError,
  AgentNotFoundError,
  MaxHandoffDepthError,
} from './core/message-processor/errors';
