import { ModelMessage } from 'ai';

/**
 * Conversation context metadata
 */
export interface ConversationMetadata {
  createdAt: Date;
  updatedAt: Date;
  [key: string]: any; // Allow additional metadata
}

/**
 * Conversation context
 */
export interface ConversationContext {
  id: string;
  messages: ModelMessage[];
  metadata: ConversationMetadata;
}

/**
 * Context storage abstraction interface
 */
export interface ContextStorage {
  get(id: string): Promise<ConversationContext | null>;
  set(id: string, context: ConversationContext): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

