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
