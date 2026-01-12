import { ContextStorage, ConversationContext } from '../../../src/core/context/context';

/**
 * Create a mock in-memory context storage for testing
 */
export function createMockStorage(): ContextStorage {
  const contexts = new Map<string, ConversationContext>();

  return {
    async get(id: string): Promise<ConversationContext | null> {
      return contexts.get(id) || null;
    },

    async set(id: string, context: ConversationContext): Promise<void> {
      contexts.set(id, context);
    },

    async delete(id: string): Promise<void> {
      contexts.delete(id);
    },

    async clear(): Promise<void> {
      contexts.clear();
    },
  };
}

/**
 * Create a mock storage that throws errors (for error testing)
 */
export function createMockStorageWithError(error: Error): ContextStorage {
  return {
    async get(): Promise<ConversationContext | null> {
      throw error;
    },
    async set(): Promise<void> {
      throw error;
    },
    async delete(): Promise<void> {
      throw error;
    },
    async clear(): Promise<void> {
      throw error;
    },
  };
}
