import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SqliteContextStorage } from '../../../../src/core/context/storage/sqlite';
import type {
  ConversationContext,
  ConversationMetadata,
} from '../../../../src/core/context/context';

// Helper to create a mock ModelMessage matching @effect/ai structure
const MessageTypeId = '~effect/ai/Prompt/Message';
const PartTypeId = '~effect/ai/Prompt/Part';

function createTextPart(text: string) {
  return {
    [PartTypeId]: PartTypeId,
    type: 'text' as const,
    text,
    options: {},
  };
}

function createToolCallPart(id: string, name: string, params: unknown) {
  return {
    [PartTypeId]: PartTypeId,
    type: 'tool-call' as const,
    id,
    name,
    params,
    providerExecuted: false,
    options: {},
  };
}

function createToolResultPart(
  id: string,
  name: string,
  result: unknown,
  isFailure = false
) {
  return {
    [PartTypeId]: PartTypeId,
    type: 'tool-result' as const,
    id,
    name,
    result,
    isFailure,
    providerExecuted: false,
    options: {},
  };
}

function createUserMessage(content: unknown[]) {
  return {
    [MessageTypeId]: MessageTypeId,
    role: 'user' as const,
    content,
    options: {},
  };
}

function createAssistantMessage(content: unknown[]) {
  return {
    [MessageTypeId]: MessageTypeId,
    role: 'assistant' as const,
    content,
    options: {},
  };
}

function createSystemMessage(content: string) {
  return {
    [MessageTypeId]: MessageTypeId,
    role: 'system' as const,
    content,
    options: {},
  };
}

describe('SqliteContextStorage', () => {
  let storage: SqliteContextStorage;

  beforeEach(() => {
    // Use in-memory database for tests
    storage = new SqliteContextStorage({ path: ':memory:' });
  });

  afterEach(() => {
    storage.close();
  });

  describe('set and get', () => {
    test('round-trips a simple conversation with text messages', async () => {
      const context: ConversationContext = {
        id: 'thread-1',
        messages: [
          createUserMessage([createTextPart('Hello')]) as any,
          createAssistantMessage([createTextPart('Hi there!')]) as any,
        ],
        metadata: {
          createdAt: new Date('2024-01-10T10:00:00Z'),
          updatedAt: new Date('2024-01-10T10:01:00Z'),
        },
      };

      await storage.set('thread-1', context);
      const retrieved = await storage.get('thread-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('thread-1');
      expect(retrieved!.messages).toHaveLength(2);
      expect((retrieved!.messages[0] as any).role).toBe('user');
      expect((retrieved!.messages[1] as any).role).toBe('assistant');
    });

    test('preserves message order with sequence numbers', async () => {
      const messages = [
        createSystemMessage('You are helpful') as any,
        createUserMessage([createTextPart('First')]) as any,
        createAssistantMessage([createTextPart('Response 1')]) as any,
        createUserMessage([createTextPart('Second')]) as any,
        createAssistantMessage([createTextPart('Response 2')]) as any,
      ];

      const context: ConversationContext = {
        id: 'thread-order',
        messages,
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      await storage.set('thread-order', context);
      const retrieved = await storage.get('thread-order');

      expect(retrieved!.messages).toHaveLength(5);
      expect((retrieved!.messages[0] as any).role).toBe('system');
      expect((retrieved!.messages[1] as any).role).toBe('user');
      expect((retrieved!.messages[2] as any).role).toBe('assistant');
      expect((retrieved!.messages[3] as any).role).toBe('user');
      expect((retrieved!.messages[4] as any).role).toBe('assistant');

      // Verify content
      expect((retrieved!.messages[0] as any).content).toBe('You are helpful');
      expect((retrieved!.messages[1] as any).content[0].text).toBe('First');
    });

    test('round-trips messages with tool calls', async () => {
      const context: ConversationContext = {
        id: 'thread-tools',
        messages: [
          createUserMessage([createTextPart('What is the weather?')]) as any,
          createAssistantMessage([
            createTextPart('Let me check.'),
            createToolCallPart('call_123', 'get_weather', { city: 'London' }),
          ]) as any,
          createAssistantMessage([
            createToolResultPart('call_123', 'get_weather', {
              temp: 18,
              condition: 'cloudy',
            }),
          ]) as any,
          createAssistantMessage([
            createTextPart('It is 18C and cloudy in London.'),
          ]) as any,
        ],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      await storage.set('thread-tools', context);
      const retrieved = await storage.get('thread-tools');

      expect(retrieved!.messages).toHaveLength(4);

      // Check tool call
      const assistantWithTool = retrieved!.messages[1] as any;
      expect(assistantWithTool.content[1].type).toBe('tool-call');
      expect(assistantWithTool.content[1].name).toBe('get_weather');
      expect(assistantWithTool.content[1].params).toEqual({ city: 'London' });

      // Check tool result
      const toolResult = retrieved!.messages[2] as any;
      expect(toolResult.content[0].type).toBe('tool-result');
      expect(toolResult.content[0].result).toEqual({
        temp: 18,
        condition: 'cloudy',
      });
    });

    test('preserves metadata timestamps', async () => {
      const createdAt = new Date('2024-01-05T08:00:00Z');
      const updatedAt = new Date('2024-01-10T15:30:00Z');

      const context: ConversationContext = {
        id: 'thread-meta',
        messages: [createUserMessage([createTextPart('Test')]) as any],
        metadata: {
          createdAt,
          updatedAt,
          userId: 'user_123',
          tags: ['support', 'urgent'],
        },
      };

      await storage.set('thread-meta', context);
      const retrieved = await storage.get('thread-meta');

      expect(retrieved!.metadata.createdAt).toBeInstanceOf(Date);
      expect(retrieved!.metadata.updatedAt).toBeInstanceOf(Date);
      expect(retrieved!.metadata.createdAt.toISOString()).toBe(
        '2024-01-05T08:00:00.000Z'
      );
      expect(retrieved!.metadata.updatedAt.toISOString()).toBe(
        '2024-01-10T15:30:00.000Z'
      );
      expect(retrieved!.metadata.userId).toBe('user_123');
      expect(retrieved!.metadata.tags).toEqual(['support', 'urgent']);
    });

    test('returns null for non-existent conversation', async () => {
      const result = await storage.get('non-existent');
      expect(result).toBeNull();
    });

    test('updates existing conversation on re-set', async () => {
      const context1: ConversationContext = {
        id: 'thread-update',
        messages: [createUserMessage([createTextPart('First')]) as any],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      await storage.set('thread-update', context1);

      const context2: ConversationContext = {
        id: 'thread-update',
        messages: [
          createUserMessage([createTextPart('First')]) as any,
          createAssistantMessage([createTextPart('Hello')]) as any,
          createUserMessage([createTextPart('Second')]) as any,
        ],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-11'),
        },
      };

      await storage.set('thread-update', context2);
      const retrieved = await storage.get('thread-update');

      expect(retrieved!.messages).toHaveLength(3);
      expect(retrieved!.metadata.updatedAt.toISOString()).toBe(
        '2024-01-11T00:00:00.000Z'
      );
    });
  });

  describe('delete', () => {
    test('removes conversation and its messages', async () => {
      const context: ConversationContext = {
        id: 'thread-delete',
        messages: [
          createUserMessage([createTextPart('Hello')]) as any,
          createAssistantMessage([createTextPart('Hi')]) as any,
        ],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      await storage.set('thread-delete', context);

      // Verify it exists
      const before = await storage.get('thread-delete');
      expect(before).not.toBeNull();

      // Delete
      await storage.delete('thread-delete');

      // Verify it's gone
      const after = await storage.get('thread-delete');
      expect(after).toBeNull();
    });

    test('handles deleting non-existent conversation gracefully', async () => {
      // Should not throw
      await storage.delete('non-existent');
    });
  });

  describe('clear', () => {
    test('removes all conversations and messages', async () => {
      // Add multiple conversations
      const context1: ConversationContext = {
        id: 'thread-1',
        messages: [createUserMessage([createTextPart('One')]) as any],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      const context2: ConversationContext = {
        id: 'thread-2',
        messages: [createUserMessage([createTextPart('Two')]) as any],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      const context3: ConversationContext = {
        id: 'thread-3',
        messages: [createUserMessage([createTextPart('Three')]) as any],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      await storage.set('thread-1', context1);
      await storage.set('thread-2', context2);
      await storage.set('thread-3', context3);

      // Verify they exist
      expect(await storage.get('thread-1')).not.toBeNull();
      expect(await storage.get('thread-2')).not.toBeNull();
      expect(await storage.get('thread-3')).not.toBeNull();

      // Clear all
      await storage.clear();

      // Verify all are gone
      expect(await storage.get('thread-1')).toBeNull();
      expect(await storage.get('thread-2')).toBeNull();
      expect(await storage.get('thread-3')).toBeNull();
    });
  });

  describe('schema initialization', () => {
    test('initializes schema on first operation', async () => {
      // The schema should be created automatically on first operation
      const context: ConversationContext = {
        id: 'test-init',
        messages: [createUserMessage([createTextPart('Test')]) as any],
        metadata: {
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      };

      // This should work without explicit initialization
      await storage.set('test-init', context);
      const retrieved = await storage.get('test-init');

      expect(retrieved).not.toBeNull();
    });

    test('works with multiple storage instances on same database', async () => {
      // Close the default storage
      storage.close();

      // Use a file-based database for this test
      const dbPath = '/tmp/fred-test-multi-instance.db';

      const storage1 = new SqliteContextStorage({ path: dbPath });
      const storage2 = new SqliteContextStorage({ path: dbPath });

      try {
        const context: ConversationContext = {
          id: 'shared-thread',
          messages: [createUserMessage([createTextPart('Hello')]) as any],
          metadata: {
            createdAt: new Date('2024-01-10'),
            updatedAt: new Date('2024-01-10'),
          },
        };

        await storage1.set('shared-thread', context);
        const retrieved = await storage2.get('shared-thread');

        expect(retrieved).not.toBeNull();
        expect(retrieved!.messages).toHaveLength(1);
      } finally {
        storage1.close();
        storage2.close();
        // Re-create in-memory storage for afterEach
        storage = new SqliteContextStorage({ path: ':memory:' });
      }
    });
  });
});
