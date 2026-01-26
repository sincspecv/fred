import { Prompt } from '@effect/ai';

export type PromptMessage = Prompt.MessageEncoded;

type LegacyToolCall = {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
};

type LegacyMessage = {
  role?: string;
  content?: unknown;
  toolCalls?: LegacyToolCall[];
  toolCallId?: string;
  toolName?: string;
  options?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPromptPart = (value: unknown): value is { type: string } =>
  isRecord(value) && typeof value.type === 'string';

const toTextContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

const parseJsonIfPossible = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const buildToolCallId = (toolName: string | undefined, index: number): string =>
  `legacy_${toolName ?? 'tool'}_${index}`;

export const normalizeMessage = (message: PromptMessage | LegacyMessage): PromptMessage => {
  if (!isRecord(message) || typeof message.role !== 'string') {
    return { role: 'user', content: toTextContent(message) };
  }

  const role = message.role as PromptMessage['role'];
  const content = message.content as unknown;
  const options = isRecord(message.options) ? message.options : undefined;

  if (role === 'assistant') {
    const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : undefined;
    if (toolCalls && toolCalls.length > 0) {
      const parts: Array<Prompt.AssistantMessagePartEncoded> = [];
      const textContent = toTextContent(content);
      if (textContent.length > 0) {
        parts.push(Prompt.makePart('text', { text: textContent }));
      }
      toolCalls.forEach((toolCall, index) => {
        const id = toolCall.toolCallId ?? buildToolCallId(toolCall.toolName, index);
        const name = toolCall.toolName ?? 'tool';
        parts.push(
          Prompt.makePart('tool-call', {
            id,
            name,
            params: toolCall.args ?? {},
            providerExecuted: false,
          })
        );
      });
      return {
        role: 'assistant',
        content: parts,
        ...(options ? { options } : {}),
      };
    }
  }

  if (role === 'tool') {
    if (Array.isArray(content) && content.every(isPromptPart)) {
      return {
        role: 'tool',
        content: content as Prompt.ToolMessagePartEncoded[],
        ...(options ? { options } : {}),
      };
    }
    const toolCallId = typeof message.toolCallId === 'string'
      ? message.toolCallId
      : buildToolCallId(message.toolName, 0);
    const toolName = typeof message.toolName === 'string' ? message.toolName : 'tool';
    const result = typeof content === 'string' ? parseJsonIfPossible(content) : content;
    return {
      role: 'tool',
      content: [
        Prompt.makePart('tool-result', {
          id: toolCallId,
          name: toolName,
          result,
          isFailure: false,
          providerExecuted: false,
        }),
      ],
      ...(options ? { options } : {}),
    };
  }

  if (Array.isArray(content) && content.every(isPromptPart)) {
    return {
      role,
      content: content as Prompt.MessageEncoded['content'],
      ...(options ? { options } : {}),
    };
  }

  return {
    role,
    content: toTextContent(content),
    ...(options ? { options } : {}),
  };
};

export const normalizeMessages = (messages: Array<PromptMessage | LegacyMessage>): PromptMessage[] =>
  messages.map((message) => normalizeMessage(message));
