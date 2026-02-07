import { Context } from 'effect';
import type { Tool } from '../tool/tool';
import type { ProviderConfigInput } from '../platform/provider';
import {
  loadConfig,
  validateConfig,
  extractIntents,
  extractAgents,
  extractPipelines,
  extractWorkflows,
  extractProviders,
  extractObservability,
  extractToolPolicies,
} from './loader';
import { loadPromptFile } from '../utils/prompt-loader';
import type { ToolPoliciesConfig } from './types';
import { PostgresContextStorage } from '../context/storage/postgres';
import { SqliteContextStorage } from '../context/storage/sqlite';
import {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from '../pipeline/checkpoint';
import type { CheckpointStorage } from '../pipeline/checkpoint';

/**
 * Interface for Fred instance (to avoid circular dependency)
 */
export interface FredLike {
  getAgentManager(): import('../agent/manager').AgentManager;
  getContextManager(): import('../context/manager').ContextManager;
  getPipelineManager(): import('../pipeline/manager').PipelineManager;
  getProviderRegistry(): import('../platform/registry').ProviderRegistry;
  getProviderService(): import('../provider/service').ProviderService;
  registerTool(tool: Tool): void;
  registerIntents(intents: import('../intent/intent').Intent[]): void;
  createAgent(config: import('../agent/agent').AgentConfig): Promise<import('../agent/agent').AgentInstance>;
  createPipeline(config: import('../pipeline').PipelineConfig): Promise<import('../pipeline').PipelineInstance>;
  configureRouting(config: import('../routing/types').RoutingConfig): void;
  configureWorkflows(workflows: import('../workflow/types').Workflow[]): void;
  configureObservability(config: import('./types').ObservabilityConfig): void;
  setToolPolicies?(policies: ToolPoliciesConfig | undefined): Promise<void> | void;
}

/**
 * Options for initialization
 */
export interface InitializerOptions {
  toolExecutors?: Map<string, Tool['execute']>;
  providers?: ProviderConfigInput;
}

/**
 * ConfigInitializer handles loading and applying configuration from YAML/JSON files.
 * Extracts the initializeFromConfig logic from Fred class.
 */
export class ConfigInitializer {
  /**
   * Initialize Fred from a config file
   */
  async initialize(
    fred: FredLike,
    configPath: string,
    options?: InitializerOptions
  ): Promise<void> {
    const agentManager = fred.getAgentManager();
    const contextManager = fred.getContextManager();
    const pipelineManager = fred.getPipelineManager();
    const providerRegistry = fred.getProviderRegistry();
    const providerService = fred.getProviderService();

    // Load and validate config
    const config = loadConfig(configPath);
    validateConfig(config);

    // Set default system message
    const defaultSystemMessage = config.defaultSystemMessage
      ? loadPromptFile(config.defaultSystemMessage, configPath, false)
      : undefined;
    agentManager.setDefaultSystemMessage(defaultSystemMessage);

    // Configure memory defaults
    const memoryDefaults = config.memory;
    if (memoryDefaults?.policy) {
      contextManager.setDefaultPolicy(memoryDefaults.policy);
    }

    // Configure persistence adapter
    if (config.persistence) {
      await this.configurePersistence(
        config.persistence,
        contextManager,
        pipelineManager
      );
    }

    // Configure observability (tracing and logging)
    const observabilityConfig = extractObservability(config);
    fred.configureObservability(observabilityConfig);

    const toolPolicies = extractToolPolicies(config);
    if (fred.setToolPolicies) {
      await fred.setToolPolicies(toolPolicies);
    }

    // Register providers
    const providers = extractProviders(config);
    if (providers.length > 0) {
      await Promise.all(
        providers.map((pack) => providerRegistry.register(pack.package, pack.config))
      );
      providerRegistry.markInitialized();
      providerService.syncProviderRegistry();
    } else if (options?.providers) {
      await providerService.registerDefaultProviders(options.providers);
    } else {
      await providerService.loadDefaultProviders();
      providerRegistry.markInitialized();
      providerService.syncProviderRegistry();
    }

    // Register tools (need execute functions)
    // Config-loaded tools have metadata-only schemas - Effect Schema types
    // are added at runtime via the execute function registration
    if (config.tools) {
      const toolExecutors = options?.toolExecutors || new Map();
      for (const toolDef of config.tools) {
        const executor = toolExecutors.get(toolDef.id);
        if (!executor) {
          throw new Error(
            `Tool "${toolDef.id}" requires an execute function. Provide it in toolExecutors option.`
          );
        }
        // Cast to Tool since config-defined tools have metadata schema only
        fred.registerTool({
          ...toolDef,
          execute: executor,
        } as Tool);
      }
    }

    // Register intents
    const intents = extractIntents(config);
    if (intents.length > 0) {
      fred.registerIntents(intents);
    }

    // Create agents (resolve prompt files relative to config path)
    const agents = extractAgents(config, configPath);
    for (const agentConfig of agents) {
      await fred.createAgent(agentConfig);
    }

    // Create pipelines (resolve prompt files in inline agents relative to config path)
    const pipelines = extractPipelines(config, configPath);
    for (const pipelineConfig of pipelines) {
      await fred.createPipeline(pipelineConfig);
    }

    // Configure routing if specified in config
    if (config.routing) {
      // Warn if defaultAgent references unknown agent
      if (config.routing.defaultAgent && !agentManager.hasAgent(config.routing.defaultAgent)) {
        console.warn(
          `[Config] Routing defaultAgent "${config.routing.defaultAgent}" not found among registered agents`
        );
      }
      fred.configureRouting(config.routing);
    }

    // Configure workflows if specified in config
    const workflows = extractWorkflows(config);
    if (workflows.length > 0) {
      fred.configureWorkflows(workflows);
    }
  }

  /**
   * Configure persistence storage
   */
  private async configurePersistence(
    persistence: {
      adapter: 'postgres' | 'sqlite';
      checkpoint?: { enabled?: boolean; ttlMs?: number; cleanupIntervalMs?: number };
    },
    contextManager: import('../context/manager').ContextManager,
    pipelineManager: import('../pipeline/manager').PipelineManager
  ): Promise<void> {
    if (persistence.adapter === 'postgres') {
      const connectionString = process.env.FRED_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          'FRED_POSTGRES_URL environment variable is required for Postgres persistence adapter'
        );
      }
      const storage = new PostgresContextStorage({ connectionString });
      contextManager.setStorage(storage);
    } else if (persistence.adapter === 'sqlite') {
      const path = process.env.FRED_SQLITE_PATH || './fred.db';
      const storage = new SqliteContextStorage({ path });
      contextManager.setStorage(storage);
    }

    // Set up checkpoint storage if persistence enabled (default: true)
    const checkpointEnabled = persistence.checkpoint?.enabled !== false;
    if (checkpointEnabled) {
      let checkpointStorage: CheckpointStorage;

      if (persistence.adapter === 'postgres') {
        const url = process.env.FRED_POSTGRES_URL;
        if (!url) {
          throw new Error('FRED_POSTGRES_URL required for postgres persistence');
        }
        checkpointStorage = new PostgresCheckpointStorage({ connectionString: url });
      } else {
        const dbPath = process.env.FRED_SQLITE_PATH ?? './fred.db';
        checkpointStorage = new SqliteCheckpointStorage({ path: dbPath });
      }

      const checkpointManager = new CheckpointManager({
        storage: checkpointStorage,
        defaultTtlMs: persistence.checkpoint?.ttlMs,
      });

      // Wire to pipeline manager
      pipelineManager.setCheckpointManager(checkpointManager);

      // Start cleanup task
      const cleanupIntervalMs = persistence.checkpoint?.cleanupIntervalMs ?? 3600000;
      const cleanupTask = new CheckpointCleanupTask(checkpointStorage, { intervalMs: cleanupIntervalMs });
      cleanupTask.start();

      // Note: Consider adding a shutdown() method to Fred that stops cleanup
    }
  }

  /**
   * Get memory defaults from config
   */
  getMemoryDefaults(configPath: string): {
    policy?: { maxMessages?: number; maxChars?: number; strict?: boolean; isolated?: boolean };
    requireConversationId?: boolean;
    sequentialVisibility?: boolean;
  } {
    const config = loadConfig(configPath);
    const memoryDefaults = config.memory;
    return {
      policy: memoryDefaults?.policy,
      requireConversationId: memoryDefaults?.requireConversationId,
      sequentialVisibility: memoryDefaults?.sequentialVisibility,
    };
  }
}

/**
 * Effect service tag for ConfigInitializer
 */
export const ConfigInitializerService = Context.GenericTag<ConfigInitializer>('ConfigInitializerService');
