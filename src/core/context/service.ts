import { Context, Effect, Layer, Ref } from 'effect';
import type { Prompt } from '@effect/ai';
import type {
  ConversationContext,
  ConversationMetadata,
  ConversationPolicy,
  ContextStorage
} from './context';
import { ContextNotFoundError, ContextStorageError } from './errors';
import { normalizeMessage, normalizeMessages } from '../messages';

/**
 * ContextStorageService interface for Effect-based conversation management
 */
export interface ContextStorageService {
  /**
   * Generate a unique conversation ID
   */
  generateConversationId(): Effect.Effect<string>;

  /**
   * Get or create a conversation context
   * In strict mode, throws if conversationId provided but not found
   */
  getContext(
    conversationId?: string,
    options?: { strict?: boolean }
  ): Effect.Effect<ConversationContext, ContextNotFoundError>;

  /**
   * Get conversation context by ID (returns null if not found)
   */
  getContextById(conversationId: string): Effect.Effect<ConversationContext | null>;

  /**
   * Add a message to the conversation context
   */
  addMessage(
    conversationId: string,
    message: Prompt.MessageEncoded
  ): Effect.Effect<void, ContextStorageError>;

  /**
   * Add multiple messages to the conversation context
   */
  addMessages(
    conversationId: string,
    messages: Prompt.MessageEncoded[]
  ): Effect.Effect<void, ContextStorageError>;

  /**
   * Get conversation history
   */
  getHistory(conversationId: string): Effect.Effect<Prompt.MessageEncoded[]>;

  /**
   * Update conversation metadata
   */
  updateMetadata(
    conversationId: string,
    metadata: Partial<ConversationMetadata>
  ): Effect.Effect<void, ContextStorageError>;

  /**
   * Clear conversation context
   */
  clearContext(conversationId: string): Effect.Effect<void>;

  /**
   * Clear and return whether context existed
   */
  resetContext(conversationId: string): Effect.Effect<boolean>;

  /**
   * Clear all conversation contexts
   */
  clearAll(): Effect.Effect<void>;

  /**
   * Set default policy for new contexts
   */
  setDefaultPolicy(policy: ConversationPolicy): Effect.Effect<void>;

  /**
   * Set a policy for an existing context
   */
  setContextPolicy(
    conversationId: string,
    policy: ConversationPolicy
  ): Effect.Effect<void, ContextStorageError>;
}

export const ContextStorageService = Context.GenericTag<ContextStorageService>(
  'ContextStorageService'
);

/**
 * In-memory storage for ContextStorageService
 */
class InMemoryStorage {
  constructor(public contexts: Ref.Ref<Map<string, ConversationContext>>) {}

  get(id: string): Effect.Effect<ConversationContext | null> {
    const self = this;
    return Effect.gen(function* () {
      const contexts = yield* Ref.get(self.contexts);
      return contexts.get(id) || null;
    });
  }

  set(id: string, context: ConversationContext): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const contexts = yield* Ref.get(self.contexts);
      const newContexts = new Map(contexts);
      newContexts.set(id, context);
      yield* Ref.set(self.contexts, newContexts);
    });
  }

  delete(id: string): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const contexts = yield* Ref.get(self.contexts);
      const newContexts = new Map(contexts);
      newContexts.delete(id);
      yield* Ref.set(self.contexts, newContexts);
    });
  }

  clear(): Effect.Effect<void> {
    return Ref.set(this.contexts, new Map());
  }
}

/**
 * Implementation of ContextStorageService
 */
class ContextStorageServiceImpl implements ContextStorageService {
  constructor(
    private storage: InMemoryStorage,
    private defaultMetadata: Ref.Ref<Partial<ConversationMetadata>>,
    private defaultPolicy: Ref.Ref<ConversationPolicy>
  ) {}

  generateConversationId(): Effect.Effect<string> {
    return Effect.succeed(`conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  }

  getContext(
    conversationId?: string,
    options?: { strict?: boolean }
  ): Effect.Effect<ConversationContext, ContextNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const id = conversationId ?? (yield* self.generateConversationId());
      const existing = yield* self.storage.get(id);
      const policy = yield* Ref.get(self.defaultPolicy);
      const strict = options?.strict ?? policy.strict;

      if (existing) {
        return existing;
      }

      if (strict && conversationId) {
        return yield* Effect.fail(new ContextNotFoundError({ conversationId }));
      }

      const metadata = yield* Ref.get(self.defaultMetadata);
      const newContext: ConversationContext = {
        id,
        messages: [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          policy,
          ...metadata,
        },
      };

      yield* self.storage.set(id, newContext);
      return newContext;
    });
  }

  getContextById(conversationId: string): Effect.Effect<ConversationContext | null> {
    return this.storage.get(conversationId);
  }

  addMessage(
    conversationId: string,
    message: Prompt.MessageEncoded
  ): Effect.Effect<void, ContextStorageError> {
    const self = this;
    return Effect.gen(function* () {
      const normalized = normalizeMessage(message);
      if (normalized.role === 'system') {
        return;
      }

      const context = yield* self.getContext(conversationId);
      context.messages.push(normalized);
      self.applyCaps(context);
      context.metadata.updatedAt = new Date();
      yield* self.storage.set(conversationId, context);
    });
  }

  addMessages(
    conversationId: string,
    messages: Prompt.MessageEncoded[]
  ): Effect.Effect<void, ContextStorageError> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.getContext(conversationId);
      const filtered = normalizeMessages(messages).filter(m => m.role !== 'system');
      if (filtered.length === 0) return;

      context.messages.push(...filtered);
      self.applyCaps(context);
      context.metadata.updatedAt = new Date();
      yield* self.storage.set(conversationId, context);
    });
  }

  getHistory(conversationId: string): Effect.Effect<Prompt.MessageEncoded[]> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.getContext(conversationId);
      return normalizeMessages(context.messages);
    });
  }

  updateMetadata(
    conversationId: string,
    metadata: Partial<ConversationMetadata>
  ): Effect.Effect<void, ContextStorageError> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.getContext(conversationId);
      context.metadata = {
        ...context.metadata,
        ...metadata,
        updatedAt: new Date(),
      };
      yield* self.storage.set(conversationId, context);
    });
  }

  clearContext(conversationId: string): Effect.Effect<void> {
    return this.storage.delete(conversationId);
  }

  resetContext(conversationId: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const existing = yield* self.storage.get(conversationId);
      if (existing) {
        yield* self.storage.delete(conversationId);
        return true;
      }
      return false;
    });
  }

  clearAll(): Effect.Effect<void> {
    return this.storage.clear();
  }

  setDefaultPolicy(policy: ConversationPolicy): Effect.Effect<void> {
    return Ref.set(this.defaultPolicy, policy);
  }

  setContextPolicy(
    conversationId: string,
    policy: ConversationPolicy
  ): Effect.Effect<void, ContextStorageError> {
    const self = this;
    return Effect.gen(function* () {
      const context = yield* self.getContext(conversationId);
      context.metadata.policy = {
        ...(context.metadata.policy ?? {}),
        ...policy,
      };
      context.metadata.updatedAt = new Date();
      self.applyCaps(context);
      yield* self.storage.set(conversationId, context);
    });
  }

  private applyCaps(context: ConversationContext): void {
    const policy = context.metadata.policy;
    if (!policy) return;

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
    if (typeof content === 'string') return content.length;
    if (content == null) return 0;
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

/**
 * Live layer providing ContextStorageService (in-memory)
 */
export const ContextStorageServiceLive = Layer.effect(
  ContextStorageService,
  Effect.gen(function* () {
    const contexts = yield* Ref.make(new Map<string, ConversationContext>());
    const storage = new InMemoryStorage(contexts);
    const defaultMetadata = yield* Ref.make<Partial<ConversationMetadata>>({});
    const defaultPolicy = yield* Ref.make<ConversationPolicy>({});
    return new ContextStorageServiceImpl(storage, defaultMetadata, defaultPolicy);
  })
);
