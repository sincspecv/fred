import { FrameworkConfig, ConfigStep, ConfigConditionalStep, ProviderPackConfig, PersistenceConfig } from './types';
import { parseConfigFile } from './parser';
import { Intent } from '../intent/intent';
import { AgentConfig } from '../agent/agent';
import { PipelineConfig, PipelineConfigV2 } from '../pipeline/pipeline';
import { PipelineStep } from '../pipeline/steps';
import { Tool, ToolSchemaMetadata } from '../tool/tool';
import { loadPromptFile } from '../utils/prompt-loader';
import { validateId, validatePipelineAgentCount } from '../utils/validation';
import { Workflow } from '../workflow/types';
import { ProviderConfig } from '../platform/provider';
import { Schema, ParseResult } from 'effect';

// =============================================================================
// Pipeline V2 Function Registry
// =============================================================================

// Module-level registry for config-resolvable functions
const functionRegistry = new Map<string, (ctx: any) => unknown | Promise<unknown>>();

/**
 * Register a function for use in config-defined pipelines.
 * Must be called before loading config that references this function.
 */
export function registerPipelineFunction(
  id: string,
  fn: (ctx: any) => unknown | Promise<unknown>
): void {
  functionRegistry.set(id, fn);
}

/**
 * Clear all registered pipeline functions.
 */
export function clearPipelineFunctions(): void {
  functionRegistry.clear();
}

/**
 * Load configuration from a file
 */
export function loadConfig(filePath: string): FrameworkConfig {
  return parseConfigFile(filePath);
}

/**
 * Validate config structure
 */
export function validateConfig(config: FrameworkConfig): void {
  const hasDefaultSystemMessage = Boolean(config.defaultSystemMessage);

  if (config.intents) {
    for (const intent of config.intents) {
      if (!intent.id) {
        throw new Error('Intent must have an id');
      }
      if (!intent.utterances || intent.utterances.length === 0) {
        throw new Error(`Intent "${intent.id}" must have at least one utterance`);
      }
      if (!intent.action) {
        throw new Error(`Intent "${intent.id}" must have an action`);
      }
      if (!intent.action.type || !intent.action.target) {
        throw new Error(`Intent "${intent.id}" action must have type and target`);
      }
    }
  }

  if (config.agents) {
    for (const agent of config.agents) {
      if (!agent.id) {
        throw new Error('Agent must have an id');
      }
      if (!agent.systemMessage && !hasDefaultSystemMessage) {
        throw new Error(`Agent "${agent.id}" must have a systemMessage or defaultSystemMessage must be configured`);
      }
      if (!agent.platform) {
        throw new Error(`Agent "${agent.id}" must have a platform`);
      }
      if (!agent.model) {
        throw new Error(`Agent "${agent.id}" must have a model`);
      }
    }
  }

  if (config.tools) {
    for (const tool of config.tools) {
      if (!tool.id) {
        throw new Error('Tool must have an id');
      }
      if (!tool.name) {
        throw new Error(`Tool "${tool.id}" must have a name`);
      }
      if (!tool.description) {
        throw new Error(`Tool "${tool.id}" must have a description`);
      }
      const schemaMetadata = tool.schema?.metadata;
      if (tool.strict && !schemaMetadata) {
        throw new Error(`Tool "${tool.id}" requires schema metadata when strict mode is enabled`);
      }
      if (schemaMetadata) {
        validateSchemaMetadata(tool.id, schemaMetadata);
      }
    }
  }

  if (config.pipelines) {
    // Check for duplicate pipeline IDs
    const seenPipelineIds = new Set<string>();
    for (const pipeline of config.pipelines) {
      if (!pipeline.id) {
        throw new Error('Pipeline must have an id');
      }
      // Validate pipeline ID format
      validateId(pipeline.id, 'Pipeline ID');
      
      // Check for duplicate IDs
      if (seenPipelineIds.has(pipeline.id)) {
        throw new Error(`Duplicate pipeline ID found: "${pipeline.id}"`);
      }
      seenPipelineIds.add(pipeline.id);
      
      if (!pipeline.agents || pipeline.agents.length === 0) {
        throw new Error(`Pipeline "${pipeline.id}" must have at least one agent`);
      }
      
      // Validate agent count
      validatePipelineAgentCount(pipeline.agents.length);
      
      // Validate agent references (strings) or inline agent configs
      for (let i = 0; i < pipeline.agents.length; i++) {
        const agentRef = pipeline.agents[i];
        if (typeof agentRef === 'string') {
          // Validate agent ID format
          validateId(agentRef, `Agent ID in pipeline "${pipeline.id}"`);
        } else {
          // Inline agent config - validate it
          if (!agentRef.id) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent at index ${i} without an id`);
          }
          // Validate inline agent ID format
          validateId(agentRef.id, `Inline agent ID in pipeline "${pipeline.id}"`);
          if (!agentRef.systemMessage && !hasDefaultSystemMessage) {
            throw new Error(
              `Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a systemMessage or defaultSystemMessage`
            );
          }
          if (!agentRef.platform) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a platform`);
          }
          if (!agentRef.model) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a model`);
          }
        }
      }
    }
  }

  // Validate routing configuration
  if (config.routing) {
    // defaultAgent must be a string if present
    if (config.routing.defaultAgent !== undefined && typeof config.routing.defaultAgent !== 'string') {
      throw new Error('Routing defaultAgent must be a string');
    }

    // rules must be an array
    if (!Array.isArray(config.routing.rules)) {
      throw new Error('Routing rules must be an array');
    }

    // Validate each rule
    for (const rule of config.routing.rules) {
      if (!rule.id) {
        throw new Error('Routing rule must have an id');
      }
      if (!rule.agent) {
        throw new Error(`Routing rule "${rule.id}" must have an agent`);
      }
      // Don't throw on unknown agent - just warn at runtime (per project decision)
    }
  }

  // Validate workflow configuration
  if (config.workflows) {
    for (const [workflowName, workflowConfig] of Object.entries(config.workflows)) {
      if (!workflowConfig.defaultAgent) {
        throw new Error(`Workflow "${workflowName}" must have a defaultAgent`);
      }
      if (!workflowConfig.agents || !Array.isArray(workflowConfig.agents)) {
        throw new Error(`Workflow "${workflowName}" must have an agents array`);
      }
      if (workflowConfig.agents.length === 0) {
        throw new Error(`Workflow "${workflowName}" must have at least one agent`);
      }
      // Warn if defaultAgent is not in agents array
      if (!workflowConfig.agents.includes(workflowConfig.defaultAgent)) {
        console.warn(
          `[Config] Workflow "${workflowName}" defaultAgent "${workflowConfig.defaultAgent}" not in agents list`
        );
      }
    }
  }

  // Validate persistence configuration
  if (config.persistence) {
    const validAdapters = ['postgres', 'sqlite'];
    if (!validAdapters.includes(config.persistence.adapter)) {
      throw new Error(
        `Invalid persistence adapter "${config.persistence.adapter}". Valid adapters are: ${validAdapters.join(', ')}`
      );
    }
  }
}

/**
 * Extract intents from config
 */
export function extractIntents(config: FrameworkConfig): Intent[] {
  return config.intents || [];
}

/**
 * Extract agents from config
 * @param config - Framework configuration
 * @param basePath - Optional base path for resolving relative prompt file paths (usually config file path)
 */
export function extractAgents(config: FrameworkConfig, basePath?: string): AgentConfig[] {
  const agents = config.agents || [];
  const defaultSystemMessage = config.defaultSystemMessage
    ? loadPromptFile(config.defaultSystemMessage, basePath, false)
    : undefined;
  
  // If basePath is provided, resolve prompt file paths
  // Paths are sandboxed to the config file's directory to prevent path traversal attacks
  if (basePath && agents.length > 0) {
    return agents.map(agent => ({
      ...agent,
      systemMessage: agent.systemMessage
        ? loadPromptFile(agent.systemMessage, basePath, false)
        : defaultSystemMessage ?? '',
    }));
  }

  return agents.map(agent => ({
    ...agent,
    systemMessage: agent.systemMessage ?? defaultSystemMessage ?? '',
  }));
}

/**
 * Extract tools from config (without execute functions)
 *
 * Config-loaded tools only have metadata (JSON Schema) - no Effect Schema.
 * They become fully typed tools when execute functions are registered at runtime.
 */
export function extractTools(config: FrameworkConfig): Omit<Tool, 'execute'>[] {
  return (config.tools || []).map(tool => {
    // Build the tool definition, handling optional schema
    const toolDef: Omit<Tool, 'execute'> = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      strict: tool.strict,
    };

    // Only include schema if metadata exists
    // Config tools only have metadata, not Effect Schema types
    if (tool.schema?.metadata) {
      (toolDef as any).schema = {
        metadata: tool.schema.metadata,
      };
    }

    return toolDef;
  }) as Omit<Tool, 'execute'>[];
}

/**
 * Extract pipelines from config
 * @param config - Framework configuration
 * @param basePath - Optional base path for resolving relative prompt file paths (usually config file path)
 */
export function extractPipelines(config: FrameworkConfig, basePath?: string): PipelineConfig[] {
  const pipelines = config.pipelines || [];
  const defaultSystemMessage = config.defaultSystemMessage
    ? loadPromptFile(config.defaultSystemMessage, basePath, false)
    : undefined;
  
  // Always return a new array of deep-copied pipeline objects to prevent mutation
  // of the original configuration
  return pipelines.map(pipeline => ({
    id: pipeline.id,
    description: pipeline.description,
    utterances: pipeline.utterances ? [...pipeline.utterances] : undefined,
    agents: pipeline.agents.map(agentRef => {
      if (typeof agentRef === 'string') {
        return agentRef;
      }
      if (!basePath) {
        return {
          ...agentRef,
          systemMessage: agentRef.systemMessage ?? defaultSystemMessage ?? '',
        };
      }
      // Inline agent config - resolve systemMessage path
      // Pass allowAbsolutePaths=false to prevent absolute path attacks
      return {
        ...agentRef,
        systemMessage: agentRef.systemMessage
          ? loadPromptFile(agentRef.systemMessage, basePath, false)
          : defaultSystemMessage ?? '',
      };
    }),
  }));
}

function validateSchemaMetadata(toolId: string, metadata: ToolSchemaMetadata): void {
  if (metadata.type !== 'object') {
    throw new Error(`Tool "${toolId}" schema metadata must be type "object"`);
  }
  if (!metadata.properties || typeof metadata.properties !== 'object') {
    throw new Error(`Tool "${toolId}" schema metadata must include properties`);
  }
}

/**
 * Extract workflows from config
 */
export function extractWorkflows(config: FrameworkConfig): Workflow[] {
  if (!config.workflows) return [];

  return Object.entries(config.workflows).map(([name, workflowConfig]) => ({
    name,
    defaultAgent: workflowConfig.defaultAgent,
    agents: workflowConfig.agents,
    routing: workflowConfig.routing,
  }));
}

// =============================================================================
// Provider Extraction
// =============================================================================

/**
 * Effect Schema for provider pack configuration validation.
 */
const ProviderPackConfigSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1, { message: () => 'Provider id is required' })),
  package: Schema.optional(Schema.String),
  apiKeyEnvVar: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  modelDefaults: Schema.optional(Schema.Struct({
    model: Schema.optional(Schema.String),
    temperature: Schema.optional(Schema.Number.pipe(Schema.between(0, 2))),
    maxTokens: Schema.optional(Schema.Number.pipe(Schema.positive())),
  })),
});

const ProvidersConfigSchema = Schema.Array(ProviderPackConfigSchema);

/**
 * Validate providers configuration with Effect Schema.
 * Returns empty array if providers is null/undefined.
 * Throws ParseError if validation fails.
 */
export function validateProvidersConfig(providers: unknown): ProviderPackConfig[] {
  if (providers === undefined || providers === null) {
    return [];
  }
  return Schema.decodeUnknownSync(ProvidersConfigSchema)(providers) as ProviderPackConfig[];
}

/**
 * Extracted provider ready for runtime registration.
 */
export interface ExtractedProvider {
  /** Provider ID (e.g., 'openai', 'anthropic') */
  id: string;
  /** Package name - either explicit or defaults to id for built-ins */
  package: string;
  /** Runtime configuration for the provider */
  config: ProviderConfig;
}

/**
 * Extract provider registrations from config.
 * Validates with Effect Schema, then converts ProviderPackConfig[] to ExtractedProvider[] for runtime use.
 */
export function extractProviders(config: FrameworkConfig): ExtractedProvider[] {
  const validated = validateProvidersConfig(config.providers);
  if (validated.length === 0) return [];

  return validated.map((pack) => ({
    id: pack.id,
    package: pack.package ?? pack.id,
    config: {
      apiKeyEnvVar: pack.apiKeyEnvVar,
      baseUrl: pack.baseUrl,
      headers: pack.headers,
      modelDefaults: pack.modelDefaults,
    },
  }));
}

// =============================================================================
// Pipeline V2 Extraction
// =============================================================================

/**
 * Extract extended pipelines from config.
 */
export function extractPipelinesV2(
  config: FrameworkConfig
): PipelineConfigV2[] {
  if (!config.pipelinesV2) {
    return [];
  }

  return Object.entries(config.pipelinesV2).map(([id, pipelineConfig]) => ({
    id,
    steps: extractPipelineSteps(pipelineConfig.steps),
    description: pipelineConfig.description,
    utterances: pipelineConfig.utterances,
    failFast: pipelineConfig.failFast ?? true,
  }));
}

/**
 * Convert config steps to PipelineStep types.
 */
function extractPipelineSteps(configSteps: ConfigStep[]): PipelineStep[] {
  return configSteps.map((step, index) => {
    switch (step.type) {
      case 'agent':
        return {
          type: 'agent',
          name: step.name,
          agentId: step.agentId,
          retry: step.retry,
          contextView: step.contextView,
        };

      case 'function': {
        const fn = functionRegistry.get(step.functionId);
        if (!fn) {
          console.warn(
            `Function "${step.functionId}" not registered, step "${step.name}" will fail at runtime`
          );
        }
        return {
          type: 'function',
          name: step.name,
          fn: fn ?? (() => { throw new Error(`Function "${step.functionId}" not registered`); }),
          retry: step.retry,
          contextView: step.contextView,
        };
      }

      case 'conditional':
        return {
          type: 'conditional',
          name: step.name,
          condition: createConditionPredicate(step.condition),
          whenTrue: extractPipelineSteps(step.whenTrue),
          whenFalse: step.whenFalse ? extractPipelineSteps(step.whenFalse) : undefined,
          retry: step.retry,
          contextView: step.contextView,
        };

      case 'pipeline':
        return {
          type: 'pipeline',
          name: step.name,
          pipelineId: step.pipelineId,
          retry: step.retry,
          contextView: step.contextView,
        };

      default:
        throw new Error(`Unknown step type at index ${index}`);
    }
  });
}

/**
 * Create condition predicate from config expression.
 */
function createConditionPredicate(
  condition: ConfigConditionalStep['condition']
): (ctx: any) => boolean {
  return (ctx: any) => {
    // Navigate to field using dot notation
    const value = getNestedValue(ctx, condition.field);

    if (condition.exists !== undefined) {
      return condition.exists ? value !== undefined : value === undefined;
    }
    if (condition.equals !== undefined) {
      return value === condition.equals;
    }
    if (condition.notEquals !== undefined) {
      return value !== condition.notEquals;
    }
    return false;
  };
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

// =============================================================================
// Observability Extraction
// =============================================================================

/**
 * Extract observability configuration from config.
 * Reads from config.observability and applies environment variable overrides.
 *
 * Environment variables:
 * - FRED_OTEL_ENDPOINT: OTLP endpoint URL
 * - FRED_OTEL_HEADERS: JSON object of headers (e.g., '{"Authorization":"Bearer token"}')
 * - FRED_LOG_LEVEL: Minimum log level (trace|debug|info|warning|error|fatal)
 *
 * @param config - Framework configuration
 * @returns Observability configuration with environment overrides applied
 */
export function extractObservability(config: FrameworkConfig): import('./types').ObservabilityConfig {
  const base = config.observability ?? {};

  // Apply environment variable overrides
  const otlpEndpoint = process.env.FRED_OTEL_ENDPOINT ?? base.otlp?.endpoint;
  const otlpHeadersJson = process.env.FRED_OTEL_HEADERS;
  const otlpHeaders = otlpHeadersJson
    ? { ...base.otlp?.headers, ...JSON.parse(otlpHeadersJson) }
    : base.otlp?.headers;

  const logLevel = (process.env.FRED_LOG_LEVEL as any) ?? base.logLevel;

  return {
    otlp: otlpEndpoint
      ? {
          endpoint: otlpEndpoint,
          headers: otlpHeaders,
        }
      : undefined,
    logLevel,
    resource: base.resource,
    enableConsoleFallback: base.enableConsoleFallback,
  };
}
