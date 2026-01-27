import { Effect, Layer, Stream } from 'effect';
import * as Schema from 'effect/Schema';
import { Tool, Toolkit, LanguageModel, Prompt } from '@effect/ai';
import { BunContext } from '@effect/platform-bun';
import { FetchHttpClient } from '@effect/platform';
import type { StreamEvent } from '../stream/events';
import { AgentConfig, AgentMessage, AgentResponse } from './agent';
import { ProviderDefinition } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { createHandoffTool, HandoffResult } from '../tool/handoff';
import { loadPromptFile } from '../../utils/prompt-loader';
import { MCPClientImpl, convertMCPToolsToFredTools } from '../mcp';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { wrapToolExecution } from '../tool/validation';
import { annotateSpan } from '../observability/otel';
import { attachErrorToSpan } from '../observability/errors';
import { normalizeMessages, filterHistoryForAgent } from '../messages';
import { streamMultiStep } from './streaming';
import { resolveTemplate } from '../variables/template';

function getSafeToolErrorMessage(toolId: string, error: unknown): string {
  // Extract user-friendly error message
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Log the error for debugging (genuine tool failures)
  console.error(`Tool "${toolId}" failed:`, errorMessage);

  // Return the actual error message to the user
  // Note: The error will be displayed via tool-error events in the streaming UI
  return errorMessage;
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

export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map();
  private tracer?: Tracer;
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
    processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
    streamMessage: (
      message: string,
      messages?: AgentMessage[],
      options?: { threadId?: string }
    ) => Stream.Stream<StreamEvent>;
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

    if (this.handoffHandler) {
      const handoffTool = createHandoffTool(
        this.handoffHandler.getAgent,
        this.handoffHandler.getAvailableAgents,
        this.tracer
      );
      tools.push(handoffTool);
    }

    const toolDefinitions = new Map<string, (typeof tools)[number]>(tools.map((tool) => [tool.id, tool]));
    const toolExecutors = new Map<string, (args: Record<string, any>) => Promise<any> | any>(
      tools.map((tool) => [tool.id, tool.execute])
    );

    for (const tool of tools) {
      if (!tool.schema) {
        tool.schema = {
          input: Schema.Struct({}),
          success: Schema.Unknown,
          failure: Schema.Never,
        };
      }

      if (!tool.schema.input) {
        tool.schema = {
          ...tool.schema,
          input: Schema.Struct({}),
        };
      }

      if (!tool.schema.success) {
        tool.schema = {
          ...tool.schema,
          success: Schema.Unknown,
        };
      }

      if (!tool.schema.failure) {
        tool.schema = {
          ...tool.schema,
          failure: Schema.Never,
        };
      }
    }

    const effectTools: Tool.Any[] = [];
    const buildToolHandler = (toolId: string, execute?: (args: Record<string, any>) => Promise<any> | any) => {
      return (input: unknown) => {
        const startTime = Date.now();
        const toolSpan = this.tracer?.startSpan('tool.execute', {
          kind: SpanKind.CLIENT,
          attributes: {
            'tool.id': toolId,
            'tool.timeout': toolTimeout,
          },
        });

        const previousActiveSpan = this.tracer?.getActiveSpan();
        if (toolSpan) {
          this.tracer?.setActiveSpan(toolSpan);
        }

        // Annotate tool span with Fred identifiers (best effort)
        const toolAnnotation = annotateSpan({
          toolId,
          agentId: config.id,
        });
        Effect.runPromise(toolAnnotation).catch(() => {});

        const toolDefinition = toolDefinitions.get(toolId);
        const executor = execute ?? toolDefinition?.execute;
        const validatedExecute = toolDefinition && executor ? wrapToolExecution(toolDefinition, executor) : executor;

        return Effect.tryPromise({
          try: async () => {
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
          },
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
                this.tracer?.setActiveSpan(previousActiveSpan);
              } else {
                this.tracer?.setActiveSpan(undefined);
              }
            })
          )
        );
      };
    };

    for (const toolDef of tools) {
      effectTools.push(
        Tool.make(toolDef.id, {
          description: toolDef.description,
          parameters: toolDef.schema?.input ? toolDef.schema.input.fields : {},
          success: toolDef.schema?.success,
          failure: toolDef.schema?.failure,
        })
      );
    }

    const mcpClientInstances: MCPClientImpl[] = [];
    if (config.mcpServers && config.mcpServers.length > 0) {
      for (const mcpConfig of config.mcpServers) {
        if (mcpConfig.enabled === false) {
          continue;
        }
        try {
          const mcpClient = new MCPClientImpl(mcpConfig);
          await mcpClient.initialize();
          mcpClientInstances.push(mcpClient);

          const clientKey = `${config.id}-${mcpConfig.id}`;
          this.mcpClients.set(clientKey, mcpClient);

          this.metrics.totalConnections++;
          this.metrics.activeConnections = this.mcpClients.size;
          this.metrics.lastConnectionTime = new Date();
          this.metrics.connectionsByAgent[config.id] = (this.metrics.connectionsByAgent[config.id] ?? 0) + 1;

          const discoveredTools = await mcpClient.listTools();
          const fredTools = convertMCPToolsToFredTools(discoveredTools, mcpClient, mcpConfig.id);
          for (const fredTool of fredTools) {
            if (!this.toolRegistry.hasTool(fredTool.id)) {
              this.toolRegistry.registerTool(fredTool);
            }
            toolExecutors.set(fredTool.id, fredTool.execute);
            toolDefinitions.set(fredTool.id, fredTool);
            effectTools.push(
              Tool.make(fredTool.id, {
                description: fredTool.description,
                parameters: fredTool.schema?.input ? fredTool.schema.input.fields : {},
                success: fredTool.schema?.success,
                failure: fredTool.schema?.failure,
              })
            );
          }
        } catch (error) {
          this.metrics.failedConnections++;
          console.error(`Failed to initialize MCP server "${mcpConfig.id}":`, error);
        }
      }
    }

    const toolkit = effectTools.length > 0 ? Toolkit.make(...effectTools) : undefined;
    const toolHandlers = Object.fromEntries(
      effectTools.map((tool) => [tool.name, buildToolHandler(tool.name, toolExecutors.get(tool.name))])
    );

    const toolLayer = toolkit
      ? toolkit.toLayer(toolHandlers)
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
      previousMessages: AgentMessage[] = []
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
      Effect.runPromise(modelAnnotation).catch(() => {});

      try {
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

        // Get the model (AiModel) and compose all layers with proper dependency resolution
        const model = await Effect.runPromise(modelEffect);
        const providerWithHttp = provider.layer.pipe(Layer.provide(FetchHttpClient.layer));
        const modelWithClient = Layer.provide(model, providerWithHttp);
        const fullLayer = Layer.mergeAll(modelWithClient, toolLayer, BunContext.layer);

        // Manual multi-step tool execution loop
        // @effect/ai doesn't automatically execute tools in the loop, so we do it manually
        const maxSteps = config.maxSteps ?? 20;
        let currentMessages = [...promptMessages];
        let finalText = '';
        let allToolCalls: Array<{ toolId: string; args: Record<string, any>; result?: unknown; metadata?: Record<string, unknown> }> = [];
        let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

        for (let step = 0; step < maxSteps; step++) {
          const prompt = Prompt.make(currentMessages);
          const program = LanguageModel.generateText({
            prompt,
            toolkit,
            toolChoice: step === 0 ? config.toolChoice : undefined, // Only apply toolChoice on first step
            temperature: config.temperature,
          });

          const result = await Effect.runPromise(
            program.pipe(Effect.provide(fullLayer))
          );

          // Accumulate usage
          if (result.usage) {
            totalUsage.inputTokens += result.usage.inputTokens ?? 0;
            totalUsage.outputTokens += result.usage.outputTokens ?? 0;
            totalUsage.totalTokens += result.usage.totalTokens ?? 0;
          }

          // Accumulate text
          finalText = result.text;

          // Check if there are tool calls that need execution
          const pendingToolCalls = (result.toolCalls ?? []).filter(tc => !tc.providerExecuted);

          if (pendingToolCalls.length === 0) {
            // No more tool calls - we're done
            break;
          }

          // Execute tools and build messages for next iteration
          const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
          if (result.text) {
            assistantParts.push(Prompt.makePart('text', { text: result.text }));
          }

          const toolResultMessages: Prompt.MessageEncoded[] = [];

          for (const toolCall of pendingToolCalls) {
            // Add tool call to assistant message
            assistantParts.push(Prompt.makePart('tool-call', {
              id: toolCall.id,
              name: toolCall.name,
              params: toolCall.params,
              providerExecuted: false,
            }));

            // Execute the tool
            const executor = toolExecutors.get(toolCall.name);
            let toolResult: unknown;
            let toolError: Error | undefined;

            if (executor) {
              try {
                toolResult = await executor(toolCall.params as Record<string, any>);
              } catch (err) {
                toolError = err instanceof Error ? err : new Error(String(err));
                toolResult = `Error: ${toolError.message}`;
              }
            } else {
              toolResult = `Error: Tool "${toolCall.name}" not found`;
            }

            // Add tool result message
            toolResultMessages.push({
              role: 'tool',
              content: [
                Prompt.makePart('tool-result', {
                  id: toolCall.id,
                  name: toolCall.name,
                  result: toolResult,
                  isFailure: !!toolError,
                  providerExecuted: false,
                }),
              ],
            });

            // Track tool call with result
            allToolCalls.push({
              toolId: toolCall.name,
              args: toolCall.params as Record<string, any>,
              result: toolResult,
              metadata: toolCall.metadata as Record<string, unknown> | undefined,
            });
          }

          // Add assistant message with tool calls
          currentMessages.push({
            role: 'assistant',
            content: assistantParts,
          });

          // Add tool result messages
          currentMessages.push(...toolResultMessages);
        }

        if (modelSpan) {
          modelSpan.setAttributes({
            'response.length': finalText.length,
            'response.finishReason': 'stop',
            'toolCalls.count': allToolCalls.length,
          });
          modelSpan.setStatus('ok');
        }

        const usage = totalUsage.totalTokens > 0 ? totalUsage : undefined;

        const handoffCall = allToolCalls.find((call) => call.toolId === 'handoff_to_agent');
        if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result) {
          return {
            content: finalText,
            toolCalls: allToolCalls,
            usage,
            handoff: handoffCall.result as HandoffResult,
          };
        }

        return {
          content: finalText,
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
    ): Stream.Stream<StreamEvent> => {
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
        Effect.sync(() => {
          const finishedAt = Date.now();
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
