import { Effect, Layer, Stream } from 'effect';
import * as Schema from 'effect/Schema';
import { Tool, Toolkit, ModelMessage, LanguageModel, Prompt } from '@effect/ai';
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

function getSafeToolErrorMessage(toolId: string, error: unknown): string {
  console.error(`Tool execution failed for "${toolId}":`, error);
  return `Tool "${toolId}" execution failed. Please try again or use a different approach.`;
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

  constructor(toolRegistry: ToolRegistry, tracer?: Tracer) {
    this.toolRegistry = toolRegistry;
    this.tracer = tracer;
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
        }).tap((result) =>
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
        ).ensuring(
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
    const toolLayer = toolkit
      ? toolkit.toLayer(
          Object.fromEntries(
            effectTools.map((tool) => [tool.name, buildToolHandler(tool.name, toolExecutors.get(tool.name))])
          )
        )
      : Layer.empty;

    const systemMessage = loadPromptFile(resolvedSystemMessage, undefined, false);

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
        const program = Effect.gen(function* () {
          const model = yield* modelEffect;
          const inputMessages: ModelMessage[] = [
            { role: 'system', content: systemMessage },
            ...previousMessages,
            { role: 'user', content: message },
          ];

          return yield* LanguageModel.generateText({
            model,
            messages: inputMessages,
            tools: toolkit,
            maxSteps: config.maxSteps ?? 20,
            toolChoice: config.toolChoice,
            temperature: config.temperature,
          });
        });

        const result = await Effect.runPromise(program.pipe(Effect.provide(provider.layer), Effect.provide(toolLayer)));

        if (modelSpan) {
          modelSpan.setAttributes({
            'response.length': result.text.length,
            'response.finishReason': result.finishReason ?? 'unknown',
            'toolCalls.count': result.toolCalls?.length ?? 0,
          });
          modelSpan.setStatus('ok');
        }

        const toolCalls = (result.toolCalls ?? []).map((toolCall) => ({
          toolId: toolCall.name,
          args: toolCall.input as Record<string, any>,
          result: toolCall.output,
          metadata: toolCall.metadata as Record<string, unknown> | undefined,
        }));

        const usage = result.usage
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined;

        const handoffCall = toolCalls.find((call) => call.toolId === 'handoff_to_agent');
        if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result) {
          return {
            content: result.text,
            toolCalls,
            usage,
            handoff: handoffCall.result as HandoffResult,
          };
        }

        return {
          content: result.text,
          toolCalls,
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

      const toPromptMessages = (messages: ModelMessage[]): Prompt.MessageEncoded[] =>
        messages.map((msg) => {
          if (msg.role === 'system') {
            return { role: 'system', content: String(msg.content) } as Prompt.SystemMessageEncoded;
          }
          if (msg.role === 'user') {
            return { role: 'user', content: String(msg.content) } as Prompt.UserMessageEncoded;
          }
          if (msg.role === 'tool') {
            return { role: 'tool', content: String(msg.content), toolCallId: (msg as any).toolCallId } as Prompt.ToolMessageEncoded;
          }

          return {
            role: 'assistant',
            content: String(msg.content ?? ''),
          } as Prompt.AssistantMessageEncoded;
        });

      const promptMessages = [
        { role: 'system', content: systemMessage } as Prompt.SystemMessageEncoded,
        ...toPromptMessages(previousMessages),
        { role: 'user', content: message } as Prompt.UserMessageEncoded,
      ];

      const prompt = Prompt.make(promptMessages as Prompt.MessageEncoded[]);

      const streamEffect = Effect.gen(function* () {
        const model = yield* modelEffect;
        return LanguageModel.streamText({
          model,
          prompt,
          toolkit,
          maxSteps: config.maxSteps ?? 20,
          toolChoice: config.toolChoice as any,
          temperature: config.temperature,
        });
      });

      const partsStream = Stream.unwrap(
        streamEffect.pipe(
          Effect.provide(provider.layer),
          Effect.provide(toolLayer),
          Effect.map((stream) => stream)
        )
      );

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

      type StreamState = {
        sequence: number;
        step: number;
        text: string;
        toolStarts: Map<string, { toolName: string; startedAt: number }>;
        toolCalls: Array<{
          toolId: string;
          args: Record<string, unknown>;
          result?: unknown;
          error?: {
            message: string;
            name?: string;
            stack?: string;
          };
        }>;
        finishReason?: string;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      };

      const initialState: StreamState = {
        sequence: 2,
        step: 0,
        text: '',
        toolStarts: new Map(),
        toolCalls: [],
      };

      const mappedEvents = partsStream.pipe(
        Stream.mapAccum(initialState, (state, part): [StreamState, StreamEvent[]] => {
          const emittedAt = Date.now();
          const nextState: StreamState = {
            ...state,
            toolStarts: new Map(state.toolStarts),
            toolCalls: [...state.toolCalls],
          };
          const events: StreamEvent[] = [];

          if (part.type === 'text-start') {
            nextState.step += 1;
          }

          if (part.type === 'text-delta') {
            nextState.text += part.delta;
            events.push({
              type: 'token',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.step,
              delta: part.delta,
              accumulated: nextState.text,
            });
          }

          if (part.type === 'tool-call') {
            const startedAtPart = Date.now();
            nextState.toolStarts.set(part.id, { toolName: part.name, startedAt: startedAtPart });
            nextState.toolCalls.push({
              toolId: part.name,
              args: part.params as Record<string, unknown>,
            });
            events.push({
              type: 'tool-call',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.step,
              toolCallId: part.id,
              toolName: part.name,
              input: part.params as Record<string, unknown>,
              startedAt: startedAtPart,
            });
          }

          if (part.type === 'tool-result') {
            const start = nextState.toolStarts.get(part.id);
            const durationMs = start ? emittedAt - start.startedAt : 0;
            if (part.isFailure) {
              const errorPayload = {
                message: typeof part.result === 'string' ? part.result : JSON.stringify(part.result),
              };
              nextState.toolCalls = nextState.toolCalls.map((call) =>
                call.toolId === part.name && !call.result && !call.error
                  ? { ...call, error: errorPayload }
                  : call
              );
              events.push({
                type: 'tool-error',
                sequence: nextState.sequence++,
                emittedAt,
                runId,
                threadId,
                messageId,
                step: nextState.step,
                toolCallId: part.id,
                toolName: part.name,
                error: errorPayload,
                completedAt: emittedAt,
                durationMs,
              });
            } else {
              nextState.toolCalls = nextState.toolCalls.map((call) =>
                call.toolId === part.name && call.result === undefined && call.error === undefined
                  ? { ...call, result: part.result }
                  : call
              );
              events.push({
                type: 'tool-result',
                sequence: nextState.sequence++,
                emittedAt,
                runId,
                threadId,
                messageId,
                step: nextState.step,
                toolCallId: part.id,
                toolName: part.name,
                output: part.result,
                completedAt: emittedAt,
                durationMs,
              });
            }
          }

          if (part.type === 'finish') {
            nextState.finishReason = part.reason;
            nextState.usage = {
              inputTokens: part.usage.inputTokens,
              outputTokens: part.usage.outputTokens,
              totalTokens: part.usage.totalTokens,
            };
            events.push({
              type: 'usage',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.step,
              usage: nextState.usage,
            });
            events.push({
              type: 'message-end',
              sequence: nextState.sequence++,
              emittedAt,
              runId,
              threadId,
              messageId,
              step: nextState.step,
              finishedAt: emittedAt,
              finishReason: part.reason,
            });
          }

          return [nextState, events];
        }),
        Stream.flatMap(([, events]) => Stream.fromIterable(events))
      );

      const finalEvent = mappedEvents.pipe(
        Stream.runFold(initialState, (state, event) => {
          if (event.type === 'token') {
            return {
              ...state,
              text: event.accumulated,
              sequence: event.sequence + 1,
            };
          }
          if (event.type === 'usage') {
            return {
              ...state,
              usage: event.usage,
              sequence: event.sequence + 1,
            };
          }
          if (event.type === 'message-end') {
            return {
              ...state,
              finishReason: event.finishReason,
              sequence: event.sequence + 1,
            };
          }
          if (event.type === 'tool-call' || event.type === 'tool-result' || event.type === 'tool-error') {
            return {
              ...state,
              sequence: Math.max(state.sequence, event.sequence + 1),
            };
          }
          return {
            ...state,
            sequence: Math.max(state.sequence, event.sequence + 1),
          };
        }),
        Effect.map((finalState) => {
          const finishedAt = Date.now();
          return {
            type: 'run-end' as const,
            sequence: finalState.sequence,
            emittedAt: finishedAt,
            runId,
            threadId,
            finishedAt,
            durationMs: finishedAt - startedAt,
            result: {
              content: finalState.text,
              toolCalls: finalState.toolCalls,
              usage: finalState.usage,
            },
          };
        })
      );

      return Stream.fromIterable(initialEvents).pipe(
        Stream.concat(mappedEvents),
        Stream.concat(Stream.fromEffect(finalEvent))
      );
    };

    return { processMessage, streamMessage };
  }
}
