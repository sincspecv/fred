import { Intent } from '../intent/intent';
import { AgentConfig } from '../agent/agent';
import { Tool, ToolSchemaMetadata } from '../tool/tool';
import { PipelineConfig } from '../pipeline/pipeline';
import { RoutingConfig } from '../routing/types';

// =============================================================================
// Provider Pack Config Types
// =============================================================================

/**
 * Provider packs can be declared in config:
 *
 * providers:
 *   - id: openai                     # Built-in, uses default package
 *     modelDefaults:
 *       model: gpt-4
 *   - id: anthropic                  # Built-in
 *   - id: mistral                    # External pack
 *     package: '@fancyrobot/fred-mistral'
 *     apiKeyEnvVar: MISTRAL_API_KEY
 */

/**
 * Config-defined provider pack declaration.
 * Can reference built-in providers by id or external packs by package name.
 */
export interface ProviderPackConfig {
  /** Provider ID (e.g., 'openai', 'anthropic', 'mistral') */
  id: string;
  /** npm package name (if not built-in). Defaults to id for built-ins. */
  package?: string;
  /** Environment variable for API key. Defaults to standard (e.g., OPENAI_API_KEY) */
  apiKeyEnvVar?: string;
  /** Custom base URL for the provider API */
  baseUrl?: string;
  /** Custom headers for API requests */
  headers?: Record<string, string>;
  /** Model defaults for this provider */
  modelDefaults?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

// =============================================================================
// Persistence Config Types
// =============================================================================

/**
 * Supported persistence adapters for conversation context storage.
 */
export type PersistenceAdapter = 'postgres' | 'sqlite';

/**
 * Configuration for checkpoint storage within persistence.
 */
export interface CheckpointConfig {
  /** Enable checkpoint storage. Default: true */
  enabled?: boolean;

  /** Default TTL for checkpoints in milliseconds. Default: 7 days (604800000ms) */
  ttlMs?: number;

  /** Cleanup interval in milliseconds. Default: 1 hour (3600000ms) */
  cleanupIntervalMs?: number;
}

/**
 * Configuration for persistence storage.
 *
 * @example
 * // Postgres (requires FRED_POSTGRES_URL env var)
 * persistence: { adapter: 'postgres' }
 *
 * // SQLite (uses FRED_SQLITE_PATH or defaults to ./fred.db)
 * persistence: { adapter: 'sqlite' }
 *
 * // With checkpoint configuration
 * persistence: {
 *   adapter: 'postgres',
 *   checkpoint: {
 *     enabled: true,
 *     ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
 *     cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
 *   }
 * }
 */
export interface PersistenceConfig {
  /** Storage adapter type */
  adapter: PersistenceAdapter;

  /** Checkpoint configuration (uses same adapter as context storage) */
  checkpoint?: CheckpointConfig;
}

// =============================================================================
// Observability Config Types
// =============================================================================

/**
 * Configuration for OpenTelemetry observability (tracing and logging).
 *
 * @example
 * // With OTLP exporter
 * observability: {
 *   otlp: {
 *     endpoint: 'http://localhost:4318/v1/traces',
 *     headers: { Authorization: 'Bearer token' }
 *   },
 *   logLevel: 'debug',
 *   resource: {
 *     serviceName: 'fred',
 *     serviceVersion: '0.1.2',
 *     environment: 'production'
 *   }
 * }
 *
 * // Minimal (uses defaults)
 * observability: {}
 */
export interface ObservabilityConfig {
  /** OTLP exporter configuration */
  otlp?: {
    /** OTLP endpoint URL (e.g., 'http://localhost:4318/v1/traces') */
    endpoint?: string;
    /** Custom headers for OTLP requests (e.g., Authorization) */
    headers?: Record<string, string>;
  };

  /** Minimum log level (defaults to 'debug' in dev, 'info' in prod) */
  logLevel?: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

  /** Resource attributes attached to all spans and logs */
  resource?: {
    /** Service name (defaults to 'fred') */
    serviceName?: string;
    /** Service version (defaults to package version) */
    serviceVersion?: string;
    /** Environment (defaults to 'development' or 'production' based on NODE_ENV) */
    environment?: string;
    /** Additional resource attributes */
    [key: string]: unknown;
  };

  /** Enable console exporter as fallback when OTLP is not configured (defaults to true in dev) */
  enableConsoleFallback?: boolean;
}

// =============================================================================
// Framework Config
// =============================================================================

/**
 * Fred framework configuration structure for config files
 */
export interface FrameworkConfig {
  intents?: Intent[];
  agents?: AgentConfig[];
  pipelines?: PipelineConfig[];
  /** Extended pipelines with step types (Phase 5+) */
  pipelinesV2?: Record<string, ExtendedPipelineConfig>;
  tools?: ToolConfig[];
  defaultSystemMessage?: string;
  memory?: MemoryConfig;
  routing?: RoutingConfig;
  workflows?: Record<string, {
    defaultAgent: string;
    agents: string[];
    routing?: RoutingConfig;
  }>;
  /** Provider pack declarations */
  providers?: ProviderPackConfig[];
  /** Persistence storage configuration */
  persistence?: PersistenceConfig;
  /** Observability configuration (tracing and logging) */
  observability?: ObservabilityConfig;
}

export interface MemoryConfig {
  policy?: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  };
  requireConversationId?: boolean;
  sequentialVisibility?: boolean;
}

/**
 * Config-defined tool definition (schema metadata only).
 */
export interface ToolConfig extends Omit<Tool, 'execute' | 'schema'> {
  schema?: {
    metadata?: ToolSchemaMetadata;
  };
}

/**
 * Config file format
 */
export type ConfigFormat = 'json' | 'yaml';

// =============================================================================
// Pipeline V2 Config Types (Phase 5+)
// =============================================================================

/**
 * Config-defined step (declarative, no functions)
 */
export type ConfigStep =
  | ConfigAgentStep
  | ConfigFunctionRefStep
  | ConfigConditionalStep
  | ConfigPipelineRefStep;

export interface ConfigStepBase {
  name: string;
  retry?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs?: number;
  };
  contextView?: 'accumulated' | 'isolated';
}

export interface ConfigAgentStep extends ConfigStepBase {
  type: 'agent';
  agentId: string;
}

/**
 * Function step in config references a registered function by ID.
 * Functions are registered via code, referenced by ID in config.
 */
export interface ConfigFunctionRefStep extends ConfigStepBase {
  type: 'function';
  functionId: string;  // Reference to registered function
}

export interface ConfigConditionalStep extends ConfigStepBase {
  type: 'conditional';
  condition: {
    field: string;  // Dot-notation path in context (e.g., "outputs.step1.status")
    equals?: unknown;
    notEquals?: unknown;
    exists?: boolean;
  };
  whenTrue: ConfigStep[];
  whenFalse?: ConfigStep[];
}

export interface ConfigPipelineRefStep extends ConfigStepBase {
  type: 'pipeline';
  pipelineId: string;
}

/**
 * Extended pipeline config for config files (Phase 5+)
 */
export interface ExtendedPipelineConfig {
  steps: ConfigStep[];
  description?: string;
  utterances?: string[];
  failFast?: boolean;
}
