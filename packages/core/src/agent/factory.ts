import { Effect, Layer, Stream } from 'effect';
import * as Schema from 'effect/Schema';
import * as AST from 'effect/SchemaAST';
import { Tool as EffectTool, Toolkit, LanguageModel, Prompt } from '@effect/ai';
import { BunContext } from '@effect/platform-bun';
import { FetchHttpClient } from '@effect/platform';
import type { StreamEvent } from '../stream/events';
import type { AgentConfig, AgentMessage, AgentResponse, ToolRetryPolicy } from './agent';
import type { ProviderDefinition } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import type { Tool as FredTool } from '../tool/tool';
import { createHandoffTool } from '../tool/handoff';
import type { HandoffResult } from '../tool/handoff';
import { loadPromptFile } from '../utils/prompt-loader';
import { MCPClientImpl, convertMCPToolsToFredTools, MCPServerRegistry } from '../mcp';
import type { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { wrapToolExecution } from '../tool/validation';
import { annotateSpan } from '../observability/otel';
import { attachErrorToSpan, classifyError, ErrorClass } from '../observability/errors';
import { normalizeMessages, filterHistoryForAgent } from '../messages';
import { streamMultiStep } from './streaming';
import { resolveTemplate } from '../variables/template';
import type { ToolGateServiceApi, ToolGateContext } from '../tool-gate/types';

type ObservabilityServiceApi = {
  logStructured: (options: {
    level: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';
    message: string;
    metadata?: Record<string, unknown>;
  }) => Effect.Effect<void>;
  recordTokenUsage: (options: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }) => Effect.Effect<void>;
  recordModelCost: (options: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }) => Effect.Effect<number | undefined>;
};

/**
 * Transform Schema.Struct fields to be OpenAI strict-mode compatible.
 *
 * OpenAI's strict mode requires ALL properties to be in the `required` array.
 * Optional fields must use nullable types (e.g., `["string", "null"]`) instead
 * of being omitted from `required`.
 *
 * This function transforms Schema.optional fields to Schema.NullOr equivalents,
 * making them required but allowing null values.
 *
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */
function transformFieldsForStrictMode(
  inputSchema: Schema.Schema.Any | undefined
): Record<string, Schema.Schema.Any> {
  if (!inputSchema) return {};

  const schemaAny = inputSchema as any;
  if (!('fields' in schemaAny)) return {};

  const fields = schemaAny.fields as Record<string, any>;
  const ast = inputSchema.ast;

  // Only transform TypeLiteral (struct) schemas
  if (ast._tag !== 'TypeLiteral') return fields;

  const transformedFields: Record<string, Schema.Schema.Any> = {};
  const propSignatures = ast.propertySignatures;

  for (const [key, fieldValue] of Object.entries(fields)) {
    // Find the corresponding property signature to check isOptional
    const propSig = propSignatures.find(
      (p: AST.PropertySignature) => p.name === key
    );

    if (propSig?.isOptional) {
      // For optional fields, extract the actual type (excluding UndefinedKeyword)
      // and wrap with NullOr to make it required but nullable.
      //
      // Schema.optional(T) creates:
      //   - PropertySignatureDeclaration with isOptional: true
      //   - ast.type is Union of [T, UndefinedKeyword]
      // We need to extract T and wrap it with NullOr.
      let innerSchema: Schema.Schema.Any;

      if (fieldValue && 'ast' in fieldValue) {
        const fieldAst = fieldValue.ast;
        if (fieldAst._tag === 'PropertySignatureDeclaration' && fieldAst.type) {
          const typeAst = fieldAst.type;
          // For optional fields, type is Union of [actualType, UndefinedKeyword]
          if (typeAst._tag === 'Union' && typeAst.types.length === 2) {
            // Extract the actual type (first member, not UndefinedKeyword)
            const actualType = typeAst.types[0];
            innerSchema = Schema.make(actualType);
          } else {
            // Fallback: use the type directly
            innerSchema = Schema.make(typeAst);
          }
        } else {
          // Unknown structure, skip transformation
          transformedFields[key] = fieldValue;
          continue;
        }
      } else if (Schema.isSchema(fieldValue)) {
        // Direct schema (shouldn't happen for optional, but handle it)
        innerSchema = fieldValue;
      } else {
        // Unknown structure, skip transformation
        transformedFields[key] = fieldValue;
        continue;
      }

      // Wrap with NullOr to make it required but nullable
      transformedFields[key] = Schema.NullOr(innerSchema);
    } else {
      // Required fields stay as-is
      transformedFields[key] = fieldValue;
    }
  }

  return transformedFields;
}

function getSafeToolErrorMessage(toolId: string, error: unknown): string {
  // Extract user-friendly error message
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Log the error for debugging (genuine tool failures)
  console.error(`Tool "${toolId}" failed:`, errorMessage);

  // Return the actual error message to the user
  // Note: The error will be displayed via tool-error events in the streaming UI
  return errorMessage;
}

function getApprovalSessionKey(context: ToolGateContext): string | undefined {
  const conversationId = context.metadata?.conversationId;
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    return conversationId;
  }

  if (context.userId && context.userId.length > 0) {
    return context.userId;
  }

  return undefined;
}

export interface MCPClientMetrics {
  totalConnections: number;
  activeConnections: number;
  failedConnections: number;
  closedConnections: number;
  connectionsByAgent: Record<string, number>;
  lastConnectionTime?: Date;
  lastDisconnectionTime?: Date;
}

type AgentRuntimeOptions = {
  policyContext?: ToolGateContext & { conversationId?: string };
};

export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map();
  private tracer?: Tracer;
  private observabilityService?: ObservabilityServiceApi;
  private defaultSystemMessage?: string;
  private metrics: MCPClientMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    failedConnections: 0,
    closedConnections: 0,
    connectionsByAgent: {},
  };
  private shutdownHooksRegistered = false;
  private globalVariablesResolver?: () => Record<string, string | number | boolean>;
  private toolGateService?: ToolGateServiceApi;
  private mcpServerRegistry?: MCPServerRegistry;

  constructor(toolRegistry: ToolRegistry, tracer?: Tracer) {
    this.toolRegistry = toolRegistry;
    this.tracer = tracer;
  }

  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): void {
    this.globalVariablesResolver = resolver;
  }

  setDefaultSystemMessage(systemMessage?: string): void {
    this.defaultSystemMessage = systemMessage;
  }

  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  setObservabilityService(observabilityService?: ObservabilityServiceApi): void {
    this.observabilityService = observabilityService;
  }

  private logWarning(message: string, metadata?: Record<string, unknown>): void {
    if (this.observabilityService) {
      void Effect.runPromise(
        this.observabilityService.logStructured({
          level: 'warning',
          message,
          metadata,
        })
      ).catch(() => {
        console.warn(message);
      });
      return;
    }

    console.warn(message);
  }

  setToolGateService(toolGateService?: ToolGateServiceApi): void {
    this.toolGateService = toolGateService;
  }

  setMCPServerRegistry(registry: MCPServerRegistry): void {
    this.mcpServerRegistry = registry;
  }

  setHandoffHandler(handler: { getAgent: (id: string) => any; getAvailableAgents: () => string[] }): void {
    this.handoffHandler = handler;
  }

  async cleanupMCPClients(agentId: string): Promise<void> {
    const keysToRemove: string[] = [];

    for (const [key, client] of this.mcpClients.entries()) {
      if (key.startsWith(`${agentId}-`)) {
        try {
          await client.close();
          this.metrics.closedConnections++;
        } catch (error) {
          console.error(`Error closing MCP client "${key}":`, error);
        }
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.mcpClients.delete(key);
    }

    this.metrics.activeConnections = this.mcpClients.size;
    delete this.metrics.connectionsByAgent[agentId];
    if (keysToRemove.length > 0) {
      this.metrics.lastDisconnectionTime = new Date();
    }
  }

  async cleanupAllMCPClients(): Promise<void> {
    const clients = Array.from(this.mcpClients.values());
    const clientCount = clients.length;
    this.mcpClients.clear();
    this.metrics.connectionsByAgent = {};

    const results = await Promise.allSettled(
      clients.map(async (client) => {
        try {
          await client.close();
          this.metrics.closedConnections++;
        } catch (error) {
          console.error('Error closing MCP client:', error);
        }
      })
    );

    this.metrics.activeConnections = 0;
    this.metrics.lastDisconnectionTime = new Date();

    const successful = results.filter((result) => result.status === 'fulfilled').length;
    if (clientCount > 0) {
      console.log(`[AgentFactory] Cleaned up ${successful}/${clientCount} MCP clients`);
    }
  }

  getMCPMetrics(): MCPClientMetrics {
    return {
      totalConnections: this.metrics.totalConnections,
      activeConnections: this.mcpClients.size,
      failedConnections: this.metrics.failedConnections,
      closedConnections: this.metrics.closedConnections,
      connectionsByAgent: this.metrics.connectionsByAgent,
      lastConnectionTime: this.metrics.lastConnectionTime,
      lastDisconnectionTime: this.metrics.lastDisconnectionTime,
    };
  }

  registerShutdownHooks(): void {
    if (this.shutdownHooksRegistered) {
      return;
    }

    this.shutdownHooksRegistered = true;

    const cleanup = async () => {
      try {
        await this.cleanupAllMCPClients();
      } catch (error) {
        console.error('[AgentFactory] Error during shutdown cleanup:', error);
      }
    };

    if (typeof process !== 'undefined') {
      process.on('SIGINT', async () => {
        await cleanup();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await cleanup();
        process.exit(0);
      });

      process.on('beforeExit', async () => {
        await cleanup();
      });
    }
  }

  async createAgent(
    config: AgentConfig,
    provider: ProviderDefinition
  ): Promise<{
    processMessage: (message: string, messages?: AgentMessage[], runtimeOptions?: AgentRuntimeOptions) => Promise<AgentResponse>;
    streamMessage: (
      message: string,
      messages?: AgentMessage[],
      options?: { threadId?: string }
    ) => Stream.Stream<StreamEvent, unknown, any>;
  }> {
    const resolvedSystemMessage = config.systemMessage ?? this.defaultSystemMessage ?? '';

    if (!resolvedSystemMessage) {
      throw new Error(`Agent "${config.id}" must have a systemMessage`);
    }

    const modelEffect = provider.getModel(config.model, {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    const missingTools = config.tools ? this.toolRegistry.getMissingToolIds(config.tools) : [];
    if (missingTools.length > 0) {
      console.warn(
        `Agent "${config.id}" references unknown tools: ${missingTools.join(', ')}. ` +
          'These tools will be skipped.'
      );
    }
    const tools = config.tools ? this.toolRegistry.getTools(config.tools) : [];
    const toolTimeout = config.toolTimeout ?? 300000;

    // Tool retry policy with defaults
    const retryPolicy: Required<ToolRetryPolicy> = {
      maxRetries: config.toolRetry?.maxRetries ?? 3,
      backoffMs: config.toolRetry?.backoffMs ?? 1000,
      maxBackoffMs: config.toolRetry?.maxBackoffMs ?? 10000,
      jitterMs: config.toolRetry?.jitterMs ?? 200,
    };

    if (this.handoffHandler) {
      const handoffTool = createHandoffTool(
        this.handoffHandler.getAgent,
        this.handoffHandler.getAvailableAgents,
        this.tracer
      );
      // Cast to FredTool for array compatibility
      tools.push(handoffTool as unknown as FredTool);
    }

    const toolDefinitions = new Map<string, (typeof tools)[number]>(tools.map((tool) => [tool.id, tool]));
    const toolExecutors = new Map<string, (args: Record<string, any>) => Promise<any> | any>(
      tools.map((tool) => [tool.id, tool.execute])
    );

    for (const tool of tools) {
      // Ensure tool has a schema with all required properties
      // Use type assertion since we're assigning compatible schema types
      if (!tool.schema) {
        (tool as any).schema = {
          input: Schema.Struct({}) as any,
          success: Schema.Unknown as any,
          failure: Schema.Never as any,
        };
      } else {
        // Fill in missing schema properties with defaults
        const schema = tool.schema as any;
        if (!schema.input) {
          schema.input = Schema.Struct({}) as any;
        }
        if (!schema.success) {
          schema.success = Schema.Unknown as any;
        }
        if (!schema.failure) {
          schema.failure = Schema.Never as any;
        }
      }
    }

    const effectTools: EffectTool.Any[] = [];

    // Helper to compute backoff with jitter
    const computeBackoff = (attempt: number): number => {
      const exponentialBackoff = retryPolicy.backoffMs * Math.pow(2, attempt);
      const boundedBackoff = Math.min(exponentialBackoff, retryPolicy.maxBackoffMs);
      const jitter = Math.random() * retryPolicy.jitterMs;
      return boundedBackoff + jitter;
    };

    // Helper to sleep for a given duration
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const buildToolHandler = (
      toolId: string,
      execute?: (args: Record<string, any>) => Promise<any> | any,
      allowedToolIds?: Set<string>,
      runtimeOptions?: AgentRuntimeOptions
    ) => {
      return (input: unknown) => {
        const self = this;

        // Check for requireApproval gate BEFORE starting execution
        if (self.toolGateService && runtimeOptions?.policyContext) {
          const checkApproval = Effect.gen(function* () {
            const gateContext: ToolGateContext = {
              intentId: runtimeOptions.policyContext?.intentId,
              agentId: runtimeOptions.policyContext?.agentId ?? config.id,
              userId: runtimeOptions.policyContext?.userId,
              role: runtimeOptions.policyContext?.role,
              metadata: {
                ...(runtimeOptions.policyContext?.metadata ?? {}),
                ...(runtimeOptions.policyContext?.conversationId
                  ? { conversationId: runtimeOptions.policyContext.conversationId }
                  : {}),
              },
            };

            const decision = yield* self.toolGateService!.evaluateToolById(toolId, gateContext);

            // If tool requires approval, check for existing approval
            if (decision.requireApproval) {
              const sessionKey = getApprovalSessionKey(gateContext);
              if (!sessionKey) {
                return yield* Effect.fail(
                  new Error(
                    `Tool "${toolId}" requires approval but no session scope is available. Provide conversationId or userId in policy context.`
                  )
                );
              }
              const hasApproval = yield* self.toolGateService!.hasApproval(toolId, sessionKey);

              if (!hasApproval) {
                // Generate approval request and return pause signal
                const approvalRequest = yield* self.toolGateService!.createApprovalRequest(decision, gateContext);

                if (approvalRequest) {
                  // Return PauseSignal to trigger HITL checkpoint
                  return {
                    __pause: true,
                    prompt: 'This action requires approval before continuing.',
                    metadata: {
                      toolId,
                      intentId: gateContext.intentId,
                      agentId: gateContext.agentId,
                      approvalRequest: true,
                    },
                    ttlMs: approvalRequest.ttlMs ?? 300000,
                  };
                }
              }
            }

            // No pause needed - return null to continue
            return null;
          });

          // Run approval check first
          const approvalCheckEffect = checkApproval.pipe(
            Effect.flatMap((pauseSignal) => {
              if (pauseSignal) {
                // Return pause signal immediately
                return Effect.succeed(pauseSignal);
              }
              // Continue with normal tool execution
              return executeToolLogic();
            })
          );

          return approvalCheckEffect;
        }

        // No approval check needed, execute directly
        return executeToolLogic();

        function executeToolLogic() {
          if (allowedToolIds && !allowedToolIds.has(toolId)) {
            const deniedError = new Error(`Tool "${toolId}" denied by policy`);
            deniedError.name = 'ToolPolicyDeniedError';
            return Effect.fail(deniedError);
          }

          const startTime = Date.now();
          const toolSpan = self.tracer?.startSpan('tool.execute', {
            kind: SpanKind.CLIENT,
            attributes: {
              'tool.id': toolId,
              'tool.timeout': toolTimeout,
              'tool.retry.maxRetries': retryPolicy.maxRetries,
            },
          });

          const previousActiveSpan = self.tracer?.getActiveSpan();
          if (toolSpan) {
            self.tracer?.setActiveSpan(toolSpan);
          }

          // Annotate tool span with Fred identifiers (best effort)
          const toolAnnotation = annotateSpan({
            toolId,
            agentId: config.id,
          });
          Effect.runPromise(toolAnnotation).catch(() => {
            self.logWarning('Failed to annotate tool execution span', {
              toolId,
              agentId: config.id,
            });
          });

          const toolDefinition = toolDefinitions.get(toolId);
          const executor = execute ?? toolDefinition?.execute;
          // Cast toolDefinition to satisfy wrapToolExecution type requirements
          const validatedExecute = toolDefinition && executor
            ? wrapToolExecution(toolDefinition as any, executor)
            : executor;

          // Execute tool with timeout
          const executeWithTimeout = async (): Promise<any> => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                const timeoutError = new Error(`Tool "${toolId}" execution timed out after ${toolTimeout}ms`);
                timeoutError.name = 'ToolTimeoutError';
                reject(timeoutError);
              }, toolTimeout);
            });

            try {
              const result = await Promise.race([
                Promise.resolve(validatedExecute ? validatedExecute(input as Record<string, any>) : undefined),
                timeoutPromise,
              ]);
              return result;
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
            }
          };

          // Execute with retry logic for retryable errors only
          const executeWithRetry = async (): Promise<any> => {
            let lastError: Error | undefined;
            let attempt = 0;

            while (attempt <= retryPolicy.maxRetries) {
              try {
                const result = await executeWithTimeout();
                // On successful retry, annotate the span
                if (attempt > 0 && toolSpan) {
                  toolSpan.addEvent('retry.success', {
                    'retry.attempt': attempt,
                    'retry.totalAttempts': attempt + 1,
                  });
                }
                return result;
              } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                lastError = err;

                // Classify error to determine if retryable
                const errorClass = classifyError(err);
                const isRetryable = errorClass === ErrorClass.RETRYABLE;

                // Annotate retry attempt on span
                if (toolSpan) {
                  toolSpan.addEvent('retry.attempt', {
                    'retry.attempt': attempt,
                    'retry.errorClass': errorClass,
                    'retry.isRetryable': isRetryable,
                    'retry.errorMessage': err.message,
                  });
                }

                // Only retry if error is retryable and we haven't exhausted attempts
                if (!isRetryable || attempt >= retryPolicy.maxRetries) {
                  if (toolSpan) {
                    toolSpan.setAttribute('tool.retry.totalAttempts', attempt + 1);
                    toolSpan.setAttribute('tool.retry.exhausted', attempt >= retryPolicy.maxRetries);
                    toolSpan.addEvent('retry.error', {
                      'retry.finalAttempt': attempt,
                      'retry.exhausted': attempt >= retryPolicy.maxRetries,
                      'retry.errorClass': errorClass,
                    });
                  }
                  throw err;
                }

                // Wait before retrying
                const backoffMs = computeBackoff(attempt);
                if (toolSpan) {
                  toolSpan.addEvent('retry.backoff', {
                    'retry.attempt': attempt,
                    'retry.backoffMs': backoffMs,
                  });
                }
                await sleep(backoffMs);
                attempt++;
              }
            }

            // Should never reach here, but throw last error just in case
            throw lastError ?? new Error(`Tool "${toolId}" failed after ${retryPolicy.maxRetries} retries`);
          };

          return Effect.tryPromise({
            try: executeWithRetry,
            catch: (error) => {
              const executionTime = Date.now() - startTime;
              const err = error instanceof Error ? error : new Error(String(error));

              if (toolSpan) {
                toolSpan.setAttribute('tool.executionTime', executionTime);
                // Use error taxonomy for span status/classification
                attachErrorToSpan(toolSpan, err, {
                  includeStack: false,
                });
              }

              if (err.name === 'ToolTimeoutError') {
                return new Error(`Tool "${toolId}" execution timed out. Please try again or use a different approach.`);
              }

              return new Error(getSafeToolErrorMessage(toolId, error));
            },
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                const executionTime = Date.now() - startTime;
                if (toolSpan) {
                  toolSpan.setAttributes({
                    'tool.executionTime': executionTime,
                    'tool.result.hasValue': result !== undefined && result !== null,
                  });
                  toolSpan.setStatus('ok');
                }
              })
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (toolSpan) {
                  toolSpan.end();
                }
                if (previousActiveSpan) {
                  self.tracer?.setActiveSpan(previousActiveSpan);
                } else {
                  self.tracer?.setActiveSpan(undefined);
                }
              })
            )
          );
        }
      };
    };

    for (const toolDef of tools) {
      // Transform Schema fields for OpenAI strict-mode compatibility.
      // This converts Schema.optional fields to Schema.NullOr, making them
      // required in the JSON Schema but allowing null values.
      const inputFields = transformFieldsForStrictMode(toolDef.schema?.input);

      effectTools.push(
        EffectTool.make(toolDef.id, {
          description: toolDef.description,
          parameters: inputFields,
          success: (toolDef.schema?.success ?? Schema.Unknown) as Schema.Schema.Any,
          failure: (toolDef.schema?.failure ?? Schema.Never) as Schema.Schema.All,
        })
      );
    }

    // MCP tool discovery from global registry
    if (this.mcpServerRegistry && config.mcpServers && config.mcpServers.length > 0) {
      for (const serverId of config.mcpServers) {
        try {
          // Discover tools from global registry for this server
          const fredTools = await Effect.runPromise(
            this.mcpServerRegistry.discoverTools(serverId)
          );

          // Apply ToolGateService filtering at discovery time
          let filteredTools = fredTools;
          if (this.toolGateService) {
            const gateContext: ToolGateContext = {
              agentId: config.id,
            };
            const filterResult = await Effect.runPromise(
              this.toolGateService.filterTools(fredTools, gateContext)
            );
            filteredTools = filterResult.allowed;

            // Log denied MCP tools
            if (filterResult.denied.length > 0) {
              this.logWarning('MCP tools denied by policy', {
                agentId: config.id,
                serverId,
                deniedToolIds: filterResult.denied.map((d) => d.toolId),
              });
            }
          }

          // Register allowed MCP tools
          for (const fredTool of filteredTools) {
            if (!this.toolRegistry.hasTool(fredTool.id)) {
              this.toolRegistry.registerTool(fredTool);
            }
            toolExecutors.set(fredTool.id, fredTool.execute);
            toolDefinitions.set(fredTool.id, fredTool);

            // Transform MCP tool fields for OpenAI strict-mode compatibility
            const mcpInputFields = transformFieldsForStrictMode(fredTool.schema?.input);

            effectTools.push(
              EffectTool.make(fredTool.id, {
                description: fredTool.description,
                parameters: mcpInputFields,
                success: (fredTool.schema?.success ?? Schema.Unknown) as Schema.Schema.Any,
                failure: (fredTool.schema?.failure ?? Schema.Never) as Schema.Schema.All,
              })
            );
          }
        } catch (error) {
          // Graceful degradation: server not found or discovery failed
          this.logWarning('Failed to discover MCP tools for agent', {
            agentId: config.id,
            serverId,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const resolveAllowedToolIds = async (runtimeOptions?: AgentRuntimeOptions): Promise<Set<string>> => {
      const defaultAllowed = new Set(effectTools.map((tool) => tool.name));

      if (!this.toolGateService) {
        return defaultAllowed;
      }

      const gateContext: ToolGateContext = {
        intentId: runtimeOptions?.policyContext?.intentId,
        agentId: runtimeOptions?.policyContext?.agentId ?? config.id,
        userId: runtimeOptions?.policyContext?.userId,
        role: runtimeOptions?.policyContext?.role,
        metadata: {
          ...(runtimeOptions?.policyContext?.metadata ?? {}),
          ...(runtimeOptions?.policyContext?.conversationId
            ? { conversationId: runtimeOptions.policyContext.conversationId }
            : {}),
        },
      };

      const allConfiguredTools = Array.from(toolDefinitions.values()) as FredTool[];
      const filtered = await Effect.runPromise(this.toolGateService.filterTools(allConfiguredTools, gateContext));
      const allowed = new Set(filtered.allowed.map((tool) => tool.id));

      if (defaultAllowed.has('handoff_to_agent')) {
        allowed.add('handoff_to_agent');
      }

      return allowed;
    };

    const toolkit = effectTools.length > 0 ? Toolkit.make(...effectTools) : undefined;
    const toolHandlers = Object.fromEntries(
      effectTools.map((tool) => [tool.name, buildToolHandler(tool.name, toolExecutors.get(tool.name))])
    );

    const toolLayer = toolkit
      ? toolkit.toLayer(toolHandlers as any)
      : Layer.empty;

    // Create set of available tool names for history filtering
    const availableToolNames = new Set(effectTools.map((tool) => tool.name));

    // Load the system message template (may contain {{ var_name }} placeholders)
    const systemMessageTemplate = loadPromptFile(resolvedSystemMessage, undefined, false);

    // Helper function to resolve system message with current variable values
    const resolveSystemMessage = (): string => {
      let resolved = systemMessageTemplate;

      // Resolve {{ var_name }} template variables if resolver is available
      if (this.globalVariablesResolver) {
        const globalVars = this.globalVariablesResolver();
        const resolveEffect = resolveTemplate(resolved, globalVars, {
          strict: false,
          removeUnresolved: false,
        });
        resolved = Effect.runSync(resolveEffect);
      }

      return resolved;
    };

    const processMessage = async (
      message: string,
      previousMessages: AgentMessage[] = [],
      runtimeOptions?: AgentRuntimeOptions
    ): Promise<AgentResponse> => {
      const modelSpan = this.tracer?.startSpan('model.call', {
        kind: SpanKind.CLIENT,
        attributes: {
          'agent.id': config.id,
          'model.name': config.model,
          'model.platform': config.platform,
          'model.temperature': config.temperature ?? 0.7,
          'model.maxTokens': config.maxTokens ?? 0,
          'message.length': message.length,
          'history.length': previousMessages.length,
          'agent.maxSteps': config.maxSteps ?? 20,
        },
      });

      const previousActiveSpan = this.tracer?.getActiveSpan();
      if (modelSpan) {
        this.tracer?.setActiveSpan(modelSpan);
      }

      // Annotate model span with Fred identifiers (best effort)
      const modelAnnotation = annotateSpan({
        agentId: config.id,
        provider: config.platform,
      });
      Effect.runPromise(modelAnnotation).catch(() => {
        this.logWarning('Failed to annotate model span', {
          agentId: config.id,
          provider: config.platform,
          model: config.model,
        });
      });

      try {
        const allowedToolIds = await resolveAllowedToolIds(runtimeOptions);
        const allowedEffectTools = effectTools.filter((tool) => allowedToolIds.has(tool.name));
        const runtimeToolkit = allowedEffectTools.length > 0 ? Toolkit.make(...allowedEffectTools) : undefined;
        const runtimeToolHandlers = Object.fromEntries(
          allowedEffectTools.map((tool) => [
            tool.name,
            buildToolHandler(tool.name, toolExecutors.get(tool.name), allowedToolIds, runtimeOptions),
          ])
        );
        const runtimeToolLayer = runtimeToolkit ? runtimeToolkit.toLayer(runtimeToolHandlers as any) : Layer.empty;
        const runtimeAvailableToolNames = new Set(allowedEffectTools.map((tool) => tool.name));

        // Resolve system message with current variable values
        const resolvedSystemMessage = resolveSystemMessage();

        // Normalize all messages
        const normalizedMessages = normalizeMessages([
          { role: 'system', content: resolvedSystemMessage },
          ...previousMessages,
          { role: 'user', content: message },
        ]);

        // Filter history to only include tool calls available to this agent
        // This prevents confusion when agents see tool calls from other agents
        const promptMessages = filterHistoryForAgent(normalizedMessages, runtimeAvailableToolNames);

        // Get the model (AiModel) and compose all layers with proper dependency resolution
        const model = await Effect.runPromise(modelEffect);
        const providerWithHttp = provider.layer.pipe(Layer.provide(FetchHttpClient.layer));
        const modelWithClient = Layer.provide(model, providerWithHttp);
        const fullLayer = Layer.mergeAll(modelWithClient, runtimeToolLayer, BunContext.layer);

        // Use @effect/ai's built-in multi-step execution
        // This prevents double execution (no manual loop to duplicate toolkit execution)
        // Use conservative maxSteps to prevent runaway tool calling
        const maxSteps = Math.min(config.maxSteps ?? 3, 3);

        const prompt = Prompt.make(promptMessages);
        // Cast options via unknown to satisfy TypeScript - the runtime types are correct
        const generateOptions = {
          prompt,
          toolkit: runtimeToolkit,
          maxSteps,
          toolChoice: config.toolChoice,
          temperature: config.temperature,
        } as unknown as Parameters<typeof LanguageModel.generateText>[0];
        const program = LanguageModel.generateText(generateOptions);

        // Provide layer and cast to never requirements for runPromise compatibility
        const providedProgram = Effect.provide(
          program as Effect.Effect<any, any, any>,
          fullLayer as any
        ) as Effect.Effect<any, any, never>;
        const result = await Effect.runPromise(providedProgram);

        // Extract tool calls from result
        const allToolCalls = (result.toolCalls ?? []).map((tc: any) => {
          const toolId = tc.name as string;
          if (!allowedToolIds.has(toolId)) {
            return {
              toolId,
              args: tc.params as Record<string, any>,
              result: `Tool "${toolId}" denied by policy`,
              error: {
                code: 'POLICY_DENIED',
                message: `Tool "${toolId}" denied by policy`,
              },
            };
          }

          return {
            toolId,
            args: tc.params as Record<string, any>,
            result: undefined,
          };
        });

        const usage = {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          totalTokens: result.usage?.totalTokens ?? 0,
        };

        // Annotate model span with token counts
        if (modelSpan && usage.totalTokens > 0) {
          modelSpan.setAttributes({
            'token.input': usage.inputTokens,
            'token.output': usage.outputTokens,
            'token.total': usage.totalTokens,
          });
        }

        // Record token usage and cost metrics if observability is available
        if (this.observabilityService && usage.totalTokens > 0) {
          try {
            // Record token usage
            await Effect.runPromise(
              this.observabilityService.recordTokenUsage({
                provider: config.platform,
                model: config.model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              })
            );

            // Record model cost if pricing is configured
            await Effect.runPromise(
              this.observabilityService.recordModelCost({
                provider: config.platform,
                model: config.model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              })
            );
          } catch (error) {
            this.logWarning('Failed to record token usage metrics', {
              agentId: config.id,
              provider: config.platform,
              model: config.model,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Check for handoff
        const handoffCall = allToolCalls.find((call: any) => call.toolId === 'handoff_to_agent');
        if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result) {
          return {
            content: result.text,
            toolCalls: allToolCalls,
            usage,
            handoff: handoffCall.result as HandoffResult,
          };
        }

        return {
          content: result.text,
          toolCalls: allToolCalls,
          usage,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (modelSpan) {
          // Use error taxonomy for span status/classification
          attachErrorToSpan(modelSpan, err, {
            includeStack: false,
          });
        }
        throw error;
      } finally {
        if (modelSpan) {
          modelSpan.end();
          if (previousActiveSpan) {
            this.tracer?.setActiveSpan(previousActiveSpan);
          } else {
            this.tracer?.setActiveSpan(undefined);
          }
        }
      }
    };

    const streamMessage = (
      message: string,
      previousMessages: AgentMessage[] = [],
      options?: { threadId?: string }
    ): Stream.Stream<StreamEvent, unknown, any> => {
      const self = this;
      const startedAt = Date.now();
      const runId = `run_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
      const messageId = `msg_${startedAt}_${Math.random().toString(36).slice(2, 6)}`;
      const threadId = options?.threadId;

      // Resolve system message with current variable values
      const resolvedSystemMessage = resolveSystemMessage();

      // Normalize all messages
      const normalizedMessages = normalizeMessages([
        { role: 'system', content: resolvedSystemMessage },
        ...previousMessages,
        { role: 'user', content: message },
      ]);

      // Filter history to only include tool calls available to this agent
      // This prevents confusion when agents see tool calls from other agents
      const promptMessages = filterHistoryForAgent(normalizedMessages, availableToolNames);

      // Compose all layers together with proper dependency resolution
      const providerWithHttp = provider.layer.pipe(Layer.provide(FetchHttpClient.layer));

      // Track state for run-end event during single pass through stream
      type StreamState = {
        sequence: number;
        text: string;
        toolCalls: Array<{
          toolId: string;
          args: Record<string, unknown>;
          result?: unknown;
          error?: {
            message: string;
            name?: string;
            stack?: string;
          };
          metadata?: Record<string, unknown>;
        }>;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      };

      let streamState: StreamState = {
        sequence: 2,
        text: '',
        toolCalls: [],
      };

      const streamEffect = modelEffect.pipe(
        Effect.map((model) => {
          // Compose model with its OpenAiClient dependency, then merge with other layers
          const modelWithClient = Layer.provide(model, providerWithHttp);
          const fullLayer = Layer.mergeAll(modelWithClient, toolLayer, BunContext.layer);

          // Use streamMultiStep for multi-step tool execution
          const multiStepStream = streamMultiStep(
            promptMessages,
            {
              model, // The actual AiModel object, not the string name
              toolkit,
              toolHandlers: toolExecutors,
              maxSteps: config.maxSteps ?? 20,
              toolChoice: config.toolChoice,
              temperature: config.temperature,
            },
            {
              runId,
              threadId,
              messageId,
            }
          );

          // Provide the full layer to the multi-step stream
          return multiStepStream.pipe(Stream.provideLayer(fullLayer));
        })
      );

      // Emit run-start and message-start before step-start events
      const initialEvents: StreamEvent[] = [
        {
          type: 'run-start',
          sequence: 0,
          emittedAt: startedAt,
          runId,
          threadId,
          input: {
            message,
            previousMessages: [...previousMessages],
          },
          startedAt,
        },
        {
          type: 'message-start',
          sequence: 1,
          emittedAt: startedAt,
          runId,
          threadId,
          messageId,
          step: 0,
          role: 'assistant',
        },
      ];

      // Single pass: emit events and track state for run-end
      const multiStepWithTracking = Stream.unwrap(streamEffect).pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            if (event.type === 'token') {
              streamState = {
                ...streamState,
                text: event.accumulated,
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            } else if (event.type === 'usage') {
              streamState = {
                ...streamState,
                usage: event.usage,
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            } else if (event.type === 'tool-call') {
              streamState = {
                ...streamState,
                toolCalls: [
                  ...streamState.toolCalls,
                  { toolId: event.toolName, args: event.input },
                ],
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            } else if (event.type === 'tool-result') {
              streamState = {
                ...streamState,
                toolCalls: streamState.toolCalls.map((call) =>
                  call.toolId === event.toolName && call.result === undefined && call.error === undefined
                    ? { ...call, result: event.output, metadata: event.metadata }
                    : call
                ),
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            } else if (event.type === 'tool-error') {
              streamState = {
                ...streamState,
                toolCalls: streamState.toolCalls.map((call) =>
                  call.toolId === event.toolName && call.result === undefined && call.error === undefined
                    ? { ...call, error: event.error }
                    : call
                ),
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            } else {
              streamState = {
                ...streamState,
                sequence: Math.max(streamState.sequence, event.sequence + 1),
              };
            }
          })
        )
      );

      // Generate run-end event after stream completes
      const runEndEvent = Stream.fromEffect(
        Effect.gen(function* () {
          const finishedAt = Date.now();

          // Annotate model span with token counts from streaming usage
          if (streamState.usage && streamState.usage.totalTokens && streamState.usage.totalTokens > 0) {
            const modelSpan = self.tracer?.getActiveSpan();
            if (modelSpan) {
              modelSpan.setAttributes({
                'token.input': streamState.usage.inputTokens ?? 0,
                'token.output': streamState.usage.outputTokens ?? 0,
                'token.total': streamState.usage.totalTokens ?? 0,
              });
            }

            // Record token usage and cost metrics if observability is available
            if (self.observabilityService) {
              try {
                // Record token usage
                yield* self.observabilityService.recordTokenUsage({
                  provider: config.platform,
                  model: config.model,
                  inputTokens: streamState.usage.inputTokens ?? 0,
                  outputTokens: streamState.usage.outputTokens ?? 0,
                });

                // Record model cost if pricing is configured
                yield* self.observabilityService.recordModelCost({
                  provider: config.platform,
                  model: config.model,
                  inputTokens: streamState.usage.inputTokens ?? 0,
                  outputTokens: streamState.usage.outputTokens ?? 0,
                });
              } catch (error) {
                self.logWarning('Failed to record streaming token usage metrics', {
                  agentId: config.id,
                  provider: config.platform,
                  model: config.model,
                  errorMessage: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }

          // Check for handoff tool result
          const handoffCall = streamState.toolCalls.find(
            (call) => call.toolId === 'handoff_to_agent' && call.result && typeof call.result === 'object'
          );
          const handoff = handoffCall?.result as { type: 'handoff'; agentId: string; message: string; context?: Record<string, unknown> } | undefined;

          return {
            type: 'run-end' as const,
            sequence: streamState.sequence,
            emittedAt: finishedAt,
            runId,
            threadId,
            finishedAt,
            durationMs: finishedAt - startedAt,
            result: {
              content: streamState.text,
              toolCalls: streamState.toolCalls,
              handoff: handoff?.type === 'handoff' ? handoff : undefined,
              usage: streamState.usage,
            },
          };
        })
      );

      return Stream.fromIterable(initialEvents).pipe(
        Stream.concat(multiStepWithTracking),
        Stream.concat(runEndEvent)
      );
    };

    return { processMessage, streamMessage };
  }
}
