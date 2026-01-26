import type { Prompt } from '@effect/ai';
import type { Prompt } from '@effect/ai';
/**
 * Conversation context metadata
 */
export interface ConversationPolicy {
  maxMessages?: number;
  maxChars?: number;
  strict?: boolean;
  isolated?: boolean;
}

export interface ConversationMetadata {
  createdAt: Date;
  updatedAt: Date;
  policy?: ConversationPolicy;
  [key: string]: any; // Allow additional metadata
}

/**
 * Conversation context
 */
export interface ConversationContext {
  id: string;
  messages: Prompt.MessageEncoded[];
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
