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
      } as PromptMessage;
    }
  }

  if (role === 'tool') {
    if (Array.isArray(content) && content.every(isPromptPart)) {
      return {
        role: 'tool',
        content: content as Prompt.ToolMessagePartEncoded[],
      } as PromptMessage;
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
    } as PromptMessage;
  }

  if (Array.isArray(content) && content.every(isPromptPart)) {
    return {
      role,
      content: content as unknown as PromptMessage['content'],
    } as PromptMessage;
  }

  return {
    role,
    content: toTextContent(content),
  } as PromptMessage;
};

export const normalizeMessages = (messages: Array<PromptMessage | LegacyMessage>): PromptMessage[] =>
  messages.map((message) => normalizeMessage(message));

/**
 * Filter conversation history to only include tool calls available to the current agent.
 *
 * This prevents agents from seeing tool calls from other agents in the conversation history,
 * which can confuse the model into thinking it has access to tools it doesn't.
 *
 * For example, if brain-agent (only has handoff_to_agent) loads history containing
 * update_task calls from task-agent, Claude might try to call update_task directly,
 * causing a ParseError.
 *
 * @param messages - Conversation history to filter
 * @param availableToolNames - Set of tool names available to current agent
 * @returns Filtered messages with only relevant tool calls
 */
export const filterHistoryForAgent = (
  messages: PromptMessage[],
  availableToolNames: Set<string>
): PromptMessage[] => {
  return messages.map((msg) => {
    // Filter assistant messages to remove tool-call parts for unavailable tools
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const filteredContent = msg.content.filter((part) => {
        if (isPromptPart(part) && part.type === 'tool-call') {
          // Only keep tool calls that are in the available toolkit
          return availableToolNames.has((part as any).name);
        }
        // Keep all non-tool-call parts (text, etc.)
        return true;
      });

      // If we filtered out all content, skip this message entirely
      if (filteredContent.length === 0) {
        return null;
      }

      return { ...msg, content: filteredContent };
    }

    // Filter tool result messages to remove results for unavailable tools
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      const filteredContent = msg.content.filter((part) => {
        if (isPromptPart(part) && part.type === 'tool-result') {
          // Only keep tool results for tools in the available toolkit
          return availableToolNames.has((part as any).name);
        }
        return true;
      });

      // If we filtered out all content, skip this message entirely
      if (filteredContent.length === 0) {
        return null;
      }

      return { ...msg, content: filteredContent };
    }

    // Keep all other messages unchanged (user, system)
    return msg;
  }).filter((msg): msg is PromptMessage => msg !== null);
};
