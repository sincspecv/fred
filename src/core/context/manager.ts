import { ModelMessage } from 'ai';
import { ConversationContext, ConversationMetadata, ContextStorage } from './context';

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

  constructor(storage?: ContextStorage, defaultMetadata?: Partial<ConversationMetadata>) {
    this.storage = storage || new InMemoryContextStorage();
    this.defaultMetadata = defaultMetadata || {};
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
  async getContext(conversationId?: string): Promise<ConversationContext> {
    const id = conversationId || this.generateConversationId();
    const existing = await this.storage.get(id);
    
    if (existing) {
      return existing;
    }

    const newContext: ConversationContext = {
      id,
      messages: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
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
  async addMessage(conversationId: string, message: ModelMessage): Promise<void> {
    const context = await this.getContext(conversationId);
    context.messages.push(message);
    context.metadata.updatedAt = new Date();
    await this.storage.set(conversationId, context);
  }

  /**
   * Add multiple messages to the conversation context
   */
  async addMessages(conversationId: string, messages: ModelMessage[]): Promise<void> {
    const context = await this.getContext(conversationId);
    context.messages.push(...messages);
    context.metadata.updatedAt = new Date();
    await this.storage.set(conversationId, context);
  }

  /**
   * Get conversation history
   */
  async getHistory(conversationId: string): Promise<ModelMessage[]> {
    const context = await this.getContext(conversationId);
    return context.messages;
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
}

