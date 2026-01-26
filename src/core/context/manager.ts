import type { Prompt } from '@effect/ai';
import { ConversationContext, ConversationMetadata, ConversationPolicy, ContextStorage } from './context';
import { normalizeMessage, normalizeMessages } from '../messages';

/**
 * In-memory context storage implementation
 */
class InMemoryContextStorage implements ContextStorage {
  private contexts: Map<string, ConversationContext> = new Map();

  async get(id: string): Promise<ConversationContext | null> {
    return this.contexts.get(id) || null;
  }

  async set(id: string, context: ConversationContext): Promise<void> {
    this.contexts.set(id, context);
  }

  async delete(id: string): Promise<void> {
    this.contexts.delete(id);
  }

  async clear(): Promise<void> {
    this.contexts.clear();
  }
}

/**
 * Global context manager for conversation history
 */
export class ContextManager {
  private storage: ContextStorage;
  private defaultMetadata: Partial<ConversationMetadata>;
  private defaultPolicy: ConversationPolicy;

  constructor(
    storage?: ContextStorage,
    defaultMetadata?: Partial<ConversationMetadata>,
    defaultPolicy?: ConversationPolicy
  ) {
    this.storage = storage || new InMemoryContextStorage();
    this.defaultMetadata = defaultMetadata || {};
    this.defaultPolicy = defaultPolicy || {};
  }

  /**
   * Generate a unique conversation ID
   */
  generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get or create a conversation context
   */
  async getContext(conversationId?: string, options?: { strict?: boolean }): Promise<ConversationContext> {
    const id = conversationId || this.generateConversationId();
    const existing = await this.storage.get(id);
    const strict = options?.strict ?? this.defaultPolicy.strict;

    if (existing) {
      return existing;
    }

    if (strict && conversationId) {
      throw new Error(`Conversation context not found: ${conversationId}`);
    }

    const newContext: ConversationContext = {
      id,
      messages: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        policy: this.defaultPolicy,
        ...this.defaultMetadata,
      },
    };

    await this.storage.set(id, newContext);
    return newContext;
  }

  /**
   * Get conversation context by ID
   */
  async getContextById(conversationId: string): Promise<ConversationContext | null> {
    return this.storage.get(conversationId);
  }

  /**
   * Add a message to the conversation context
   */
  async addMessage(conversationId: string, message: Prompt.MessageEncoded): Promise<void> {
    const normalized = normalizeMessage(message);
    if (normalized.role === 'system') {
      return;
    }
    const context = await this.getContext(conversationId);
    context.messages.push(normalized);
    this.applyCaps(context);
    context.metadata.updatedAt = new Date();
    await this.storage.set(conversationId, context);
  }

  /**
   * Add multiple messages to the conversation context
   */
  async addMessages(conversationId: string, messages: Prompt.MessageEncoded[]): Promise<void> {
    const context = await this.getContext(conversationId);
    const filteredMessages = normalizeMessages(messages).filter(message => message.role !== 'system');
    if (filteredMessages.length === 0) {
      return;
    }
    context.messages.push(...filteredMessages);
    this.applyCaps(context);
    context.metadata.updatedAt = new Date();
    await this.storage.set(conversationId, context);
  }

  /**
   * Get conversation history
   */
  async getHistory(conversationId: string): Promise<Prompt.MessageEncoded[]> {
    const context = await this.getContext(conversationId);
    return normalizeMessages(context.messages);
  }

  /**
   * Update conversation metadata
   */
  async updateMetadata(conversationId: string, metadata: Partial<ConversationMetadata>): Promise<void> {
    const context = await this.getContext(conversationId);
    context.metadata = {
      ...context.metadata,
      ...metadata,
      updatedAt: new Date(),
    };
    await this.storage.set(conversationId, context);
  }

  /**
   * Clear conversation context
   */
  async clearContext(conversationId: string): Promise<void> {
    await this.storage.delete(conversationId);
  }

  /**
   * Clear conversation context and return whether it existed
   */
  async resetContext(conversationId: string): Promise<boolean> {
    const existing = await this.storage.get(conversationId);
    if (existing) {
      await this.storage.delete(conversationId);
      return true;
    }
    return false;
  }

  /**
   * Clear all conversation contexts
   */
  async clearAll(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Set custom storage implementation
   */
  setStorage(storage: ContextStorage): void {
    this.storage = storage;
  }

  /**
   * Set default policy for new contexts
   */
  setDefaultPolicy(policy: ConversationPolicy): void {
    this.defaultPolicy = policy;
  }

  /**
   * Set a policy for an existing context
   */
  async setContextPolicy(conversationId: string, policy: ConversationPolicy): Promise<void> {
    const context = await this.getContext(conversationId);
    context.metadata.policy = {
      ...(context.metadata.policy ?? {}),
      ...policy,
    };
    context.metadata.updatedAt = new Date();
    this.applyCaps(context);
    await this.storage.set(conversationId, context);
  }

  private applyCaps(context: ConversationContext): void {
    const policy = context.metadata.policy ?? this.defaultPolicy;
    if (!policy) {
      return;
    }

    if (policy.maxMessages !== undefined && policy.maxMessages >= 0) {
      if (context.messages.length > policy.maxMessages) {
        context.messages.splice(0, context.messages.length - policy.maxMessages);
      }
    }

    if (policy.maxChars !== undefined && policy.maxChars >= 0) {
      let totalChars = context.messages.reduce((sum, msg) => sum + this.countMessageChars(msg), 0);
      while (context.messages.length > 0 && totalChars > policy.maxChars) {
        const removed = context.messages.shift();
        if (removed) {
          totalChars -= this.countMessageChars(removed);
        }
      }
    }
  }

  private countMessageChars(message: Prompt.MessageEncoded): number {
    const content = message.content;
    if (typeof content === 'string') {
      return content.length;
    }
    if (content == null) {
      return 0;
    }
    if (Array.isArray(content)) {
      return content.reduce((sum, part) => {
        if (part && typeof part === 'object' && 'type' in part && part.type === 'text') {
          const text = (part as { text?: string }).text;
          return sum + (typeof text === 'string' ? text.length : 0);
        }
        return sum + JSON.stringify(part).length;
      }, 0);
    }
    return JSON.stringify(content).length;
  }
}
