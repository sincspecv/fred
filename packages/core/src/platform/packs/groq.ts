import { Effect, Layer, Stream, Option } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { FetchHttpClient } from '@effect/platform';
import * as AiError from '@effect/ai/AiError';
import * as AiModel from '@effect/ai/Model';
import * as LanguageModel from '@effect/ai/LanguageModel';
import * as Prompt from '@effect/ai/Prompt';
import * as Response from '@effect/ai/Response';
import * as Tool from '@effect/ai/Tool';
import { IdGenerator } from '@effect/ai/IdGenerator';
import type { EffectProviderFactory } from '../base';
import type { ProviderConfig, ProviderModelDefaults } from '../provider';

/**
 * Groq Chat Completions API response types
 */
interface ChatCompletionMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: string | null;
  delta?: ChatCompletionMessage;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ChatCompletionStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Create a Groq-compatible LanguageModel using the Chat Completions API.
 * This is necessary because @effect/ai-openai v0.30+ uses OpenAI's Responses API
 * which is not supported by Groq.
 */
function createGroqLanguageModel(
  apiKey: string,
  apiUrl: string,
  modelId: string,
  overrides?: ProviderModelDefaults
) {
  const temperature = overrides?.temperature;
  const maxTokens = overrides?.maxTokens;

  return AiModel.make('groq', Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientWithBaseUrl = httpClient.pipe(
        HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.prependUrl(apiUrl),
            HttpClientRequest.bearerToken(apiKey),
            HttpClientRequest.setHeader('Content-Type', 'application/json')
          )
        )
      );
      const clientWithBaseUrlOk = HttpClient.filterStatusOk(clientWithBaseUrl);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return yield* LanguageModel.make({
        generateText: Effect.fnUntraced(function* (options: LanguageModel.ProviderOptions) {
          const messages = convertPromptToMessages(options.prompt);
          const tools = convertToolsToFunctions(options.tools);
          const toolChoice = resolveToolChoice(options.toolChoice, tools);
          const responseFormat = resolveResponseFormat(options.responseFormat);

          const requestBody: Record<string, unknown> = {
            model: modelId,
            messages,
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...(tools && { tools }),
            ...(toolChoice && { tool_choice: toolChoice }),
            ...(responseFormat && { response_format: responseFormat })
          };

          const request = HttpClientRequest.post('/chat/completions', {
            body: HttpBody.unsafeJson(requestBody),
          }).pipe(HttpClientRequest.setHeader('Accept', 'text/event-stream'));

          const response = yield* clientWithBaseUrlOk.execute(request).pipe(
            Effect.catchAll((error) =>
              Effect.fail(new AiError.UnknownError({
                module: 'GroqProvider',
                method: 'generateText',
                description: 'HTTP request failed',
                cause: error
              }))
            )
          );

          const json = (yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
            Effect.catchAll((error) =>
              Effect.fail(new AiError.MalformedOutput({
                module: 'GroqProvider',
                method: 'generateText',
                description: 'Failed to parse response JSON',
                cause: error
              }))
            )
          )) as ChatCompletionResponse;
          const choice = json.choices[0];

          if (!choice) {
            return yield* Effect.fail(new AiError.MalformedOutput({
              module: 'GroqProvider',
              method: 'generateText',
              description: 'No response choices from Groq API'
            }));
          }

          const parts: Array<Response.PartEncoded> = [];
          const content = choice.message.content ?? '';
          if (content.length > 0) {
            parts.push({ type: 'text', text: content });
          }

          const toolCalls = choice.message.tool_calls ?? [];
          for (const toolCall of toolCalls) {
            const parsedArgs = yield* parseToolCallArguments(toolCall.function.arguments, 'generateText');
            parts.push({
              type: 'tool-call',
              id: toolCall.id,
              name: toolCall.function.name,
              params: parsedArgs,
              providerExecuted: false
            });
          }

          parts.push({
            type: 'finish',
            reason: mapFinishReason(choice.finish_reason),
            usage: mapUsage(json.usage)
          });

          return parts;
        }) as any,

        streamText: ((options: LanguageModel.ProviderOptions) => Stream.unwrapScoped(Effect.gen(function* () {
          const idGenerator = yield* IdGenerator;
          const messages = convertPromptToMessages(options.prompt);
          const tools = convertToolsToFunctions(options.tools);
          const toolChoice = resolveToolChoice(options.toolChoice, tools);
          const responseFormat = resolveResponseFormat(options.responseFormat);

          const requestBody: Record<string, unknown> = {
            model: modelId,
            messages,
            stream: true,
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...(tools && { tools }),
            ...(toolChoice && { tool_choice: toolChoice }),
            ...(responseFormat && { response_format: responseFormat })
          };

          const request = HttpClientRequest.post('/chat/completions', {
            body: HttpBody.unsafeJson(requestBody),
          }).pipe(HttpClientRequest.setHeader('Accept', 'text/event-stream'));

          const response = yield* clientWithBaseUrl.execute(request).pipe(
            Effect.timeoutFail({
              duration: Duration.seconds(120),
              onTimeout: () => new AiError.UnknownError({
                module: 'GroqProvider',
                method: 'streamText',
                description: 'Groq request timed out'
              })
            }),
            Effect.catchAll((error) =>
              Effect.fail(new AiError.UnknownError({
                module: 'GroqProvider',
                method: 'streamText',
                description: 'HTTP request failed',
                cause: error
              }))
            )
          );

          const textId = yield* idGenerator.generateId();

          // State for tracking stream progress (using Effect Ref would be ideal but keeping simple for now)
          type StreamState = { hasEmittedStart: boolean; pendingToolCalls: Map<number, { id: string; name: string; args: string }> };
          const initialState: StreamState = { hasEmittedStart: false, pendingToolCalls: new Map() };

          // Parse SSE stream from response body and transform to parts
          return parseSSEStream(response.stream).pipe(
            Stream.mapAccum(initialState, (state, chunk: ChatCompletionStreamChunk) => {
              const parts: Response.StreamPartEncoded[] = [];
              const nextState = { ...state, pendingToolCalls: new Map(state.pendingToolCalls) };

              // Guard against malformed chunks
              if (!chunk?.choices?.length) {
                return [nextState, parts] as const;
              }

              const choice = chunk.choices[0];
              if (!choice?.delta) {
                return [nextState, parts] as const;
              }

              // Handle text content
              const content = choice.delta.content;
              if (content && content.length > 0) {
                if (!nextState.hasEmittedStart) {
                  parts.push({ type: 'text-start', id: textId });
                  nextState.hasEmittedStart = true;
                }
                parts.push({ type: 'text-delta', id: textId, delta: content });
              }

              // Handle tool calls (Groq streams tool calls incrementally)
              const toolCalls = choice.delta.tool_calls ?? [];
              for (const toolCall of toolCalls) {
                const idx = toolCall.index;
                const existing = nextState.pendingToolCalls.get(idx);

                if (toolCall.id || toolCall.function?.name) {
                  // New tool call starting
                  nextState.pendingToolCalls.set(idx, {
                    id: toolCall.id ?? existing?.id ?? `call_${idx}`,
                    name: toolCall.function?.name ?? existing?.name ?? '',
                    args: toolCall.function?.arguments ?? ''
                  });
                } else if (existing && toolCall.function?.arguments) {
                  // Append arguments to existing tool call
                  existing.args += toolCall.function.arguments;
                }
              }

              // Handle finish
              if (choice.finish_reason) {
                if (nextState.hasEmittedStart) {
                  parts.push({ type: 'text-end', id: textId });
                }

                // Emit completed tool calls
                for (const [, tc] of nextState.pendingToolCalls) {
                  if (tc.id && tc.name) {
                    let parsedArgs = {};
                    try {
                      parsedArgs = tc.args ? JSON.parse(tc.args) : {};
                    } catch {
                      // Keep empty args on parse failure
                    }
                    parts.push({
                      type: 'tool-call',
                      id: tc.id,
                      name: tc.name,
                      params: parsedArgs,
                      providerExecuted: false
                    });
                  }
                }

                parts.push({
                  type: 'finish',
                  reason: mapFinishReason(choice.finish_reason),
                  usage: mapUsage(chunk.usage)
                });
              }

              return [nextState, parts] as const;
            }),
            Stream.flatMap((parts: readonly Response.StreamPartEncoded[]) => Stream.fromIterable(parts)),
            // Map any stream errors to AiError
            Stream.catchAll((error) =>
              Stream.fail(new AiError.UnknownError({
                module: 'GroqProvider',
                method: 'streamText',
                description: 'Stream processing error',
                cause: error
              }))
            )
          );
        }))) as any
      });
    })
  ));
}

/**
 * Groq message format with optional tool calls
 */
interface GroqMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Convert @effect/ai Prompt to Groq Chat Completions messages format
 */
function convertPromptToMessages(prompt: Prompt.Prompt): GroqMessage[] {
  const messages: GroqMessage[] = [];

  for (const message of prompt.content) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: message.content });
    } else if (message.role === 'user') {
      // Handle user message content (can be array of parts)
      let content = '';
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') {
            content += part.text;
          }
        }
      } else if (typeof message.content === 'string') {
        content = message.content;
      }
      messages.push({ role: 'user', content });
    } else if (message.role === 'assistant') {
      // Handle assistant messages - may contain text and/or tool calls
      let content = '';
      const toolCalls: GroqMessage['tool_calls'] = [];

      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') {
            content += part.text;
          } else if (part.type === 'tool-call') {
            // @effect/ai encodes tool calls as parts in assistant messages
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.params),
              },
            });
          }
        }
      } else if (typeof message.content === 'string') {
        content = message.content;
      }

      const assistantMessage: GroqMessage = {
        role: 'assistant',
        content: content || null,
      };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      messages.push(assistantMessage);
    } else if (message.role === 'tool') {
      // Tool result messages - @effect/ai stores tool results as content array with tool-result parts
      const toolMessage = message as any;
      const content = toolMessage.content;

      if (Array.isArray(content)) {
        // Handle @effect/ai format: content is array of tool-result parts
        for (const part of content) {
          if (part.type === 'tool-result') {
            messages.push({
              role: 'tool',
              content: typeof part.result === 'string' ? part.result : JSON.stringify(part.result),
              tool_call_id: part.id,
            });
          }
        }
      } else {
        // Fallback for legacy format
        messages.push({
          role: 'tool',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          tool_call_id: toolMessage.toolCallId ?? toolMessage.id,
        });
      }
    }
  }

  return messages;
}

/**
 * Convert @effect/ai tools to Groq function call format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToolsToFunctions(tools: ReadonlyArray<Tool.Any> | undefined): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      // Cast to any to access tool methods - Tool.Any is structurally compatible
      description: Tool.getDescription(tool as any) ?? '',
      parameters: Tool.getJsonSchema(tool as any),
    },
  }));
}

function resolveToolChoice(
  toolChoice: LanguageModel.ToolChoice<any>,
  tools: Array<{ type: 'function'; function: { name: string } }> | undefined
): string | { type: 'function'; function: { name: string } } | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
    return toolChoice;
  }
  if (typeof toolChoice === 'object' && 'tool' in toolChoice) {
    return { type: 'function', function: { name: toolChoice.tool } };
  }
  if (typeof toolChoice === 'object' && 'oneOf' in toolChoice) {
    if (toolChoice.mode === 'required' && toolChoice.oneOf.length > 0) {
      return { type: 'function', function: { name: toolChoice.oneOf[0] } };
    }
    return 'auto';
  }
  return undefined;
}

function resolveResponseFormat(responseFormat: LanguageModel.ProviderOptions['responseFormat']): { type: 'json_object' } | undefined {
  if (responseFormat.type === 'json') {
    return { type: 'json_object' };
  }
  return undefined;
}

function mapFinishReason(reason: string | null): typeof Response.FinishReason.Encoded {
  if (!reason) {
    return 'unknown';
  }
  switch (reason) {
    case 'tool_calls':
      return 'tool-calls';
    case 'content_filter':
      return 'content-filter';
    case 'length':
    case 'stop':
    case 'pause':
    case 'error':
    case 'other':
      return reason;
    default:
      return 'other';
  }
}

function mapUsage(usage: ChatCompletionResponse['usage'] | ChatCompletionStreamChunk['usage'] | undefined): typeof Response.Usage.Encoded {
  return {
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens
  };
}

/**
 * Parse SSE (Server-Sent Events) stream from Effect HttpClient response stream.
 * Transforms a Stream<Uint8Array> into a Stream of parsed ChatCompletionStreamChunk objects.
 */
function parseSSEStream<E>(
  bodyStream: Stream.Stream<Uint8Array, E>
): Stream.Stream<ChatCompletionStreamChunk, E | AiError.UnknownError> {
  const decoder = new TextDecoder();

  return bodyStream.pipe(
    // Decode bytes to text and accumulate into lines
    Stream.mapAccum('', (buffer, chunk: Uint8Array) => {
      const text = buffer + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      // Keep incomplete line in buffer
      const remaining = lines.pop() ?? '';
      return [remaining, lines] as const;
    }),
    // Flatten the lines arrays (mapAccum emits the second element of each tuple)
    Stream.flatMap((lines: readonly string[]) => Stream.fromIterable(lines)),
    // Parse each SSE line into a chunk
    Stream.filterMap((line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') {
        return Option.none();
      }
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const parsed = JSON.parse(jsonStr) as ChatCompletionStreamChunk;
          return Option.some(parsed);
        } catch {
          // Skip malformed JSON chunks
          return Option.none();
        }
      }
      return Option.none();
    })
  );
}

function parseToolCallArguments(
  raw: string,
  method: 'generateText' | 'streamText'
): Effect.Effect<unknown, AiError.MalformedOutput> {
  if (raw.length === 0) {
    return Effect.succeed({});
  }
  return Effect.try({
    try: () => JSON.parse(raw),
    catch: (cause) => new AiError.MalformedOutput({
      module: 'GroqProvider',
      method,
      description: 'Failed to parse tool call arguments',
      cause
    })
  });
}

/**
 * Groq provider pack factory.
 * Uses Groq's Chat Completions API directly.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern.
 */
export const GroqProviderFactory: EffectProviderFactory = {
  id: 'groq',
  aliases: ['groq'],
  load: async (config: ProviderConfig) => {
    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'GROQ_API_KEY';
    const apiKey = process.env[apiKeyEnvVar];
    const apiUrl = config.baseUrl ?? 'https://api.groq.com/openai/v1';

    if (!apiKey) {
      throw new Error(`Groq API key not found. Set ${apiKeyEnvVar} environment variable.`);
    }

    // Create a minimal layer for HTTP client
    const layer = FetchHttpClient.layer;

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        return Effect.succeed(
          createGroqLanguageModel(apiKey, apiUrl, modelId, overrides)
        );
      },
    };
  },
};

export default GroqProviderFactory;
