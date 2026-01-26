import { describe, test, expect, beforeEach } from 'bun:test';
import { ContextManager } from '../../../../src/core/context/manager';
import { createMockStorage } from '../../helpers/mock-storage';
import { ContextStorage, ConversationContext } from '../../../../src/core/context/context';
import type { Prompt } from '@effect/ai';

describe('ContextManager', () => {
  let manager: ContextManager;
  let mockStorage: ContextStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    manager = new ContextManager(mockStorage);
  });

  describe('generateConversationId', () => {
    test('should generate unique conversation IDs', () => {
      const id1 = manager.generateConversationId();
      const id2 = manager.generateConversationId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conv_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^conv_\d+_[a-z0-9]+$/);
    });

    test('should generate IDs with correct format', () => {
      const id = manager.generateConversationId();
      expect(id).toMatch(/^conv_/);
      expect(id.split('_').length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getContext', () => {
    test('should create new context when ID not provided', async () => {
      const context = await manager.getContext();

      expect(context).toBeDefined();
      expect(context.id).toBeDefined();
      expect(context.messages).toEqual([]);
      expect(context.metadata.createdAt).toBeInstanceOf(Date);
      expect(context.metadata.updatedAt).toBeInstanceOf(Date);
    });

    test('should create new context when ID does not exist', async () => {
      const context = await manager.getContext('new-conversation');

      expect(context.id).toBe('new-conversation');
      expect(context.messages).toEqual([]);
    });

    test('should return existing context when ID exists', async () => {
      const existingContext: ConversationContext = {
        id: 'existing-conversation',
        messages: [
          { role: 'user', content: 'hello' },
        ],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      await mockStorage.set('existing-conversation', existingContext);
      const context = await manager.getContext('existing-conversation');

      expect(context.id).toBe('existing-conversation');
      expect(context.messages).toHaveLength(1);
      expect(context.messages[0].content).toBe('hello');
    });

    test('should throw in strict mode when context missing', async () => {
      await expect(manager.getContext('missing', { strict: true })).rejects.toThrow(
        'Conversation context not found: missing'
      );
    });

    test('should merge default metadata', async () => {
      const managerWithDefaults = new ContextManager(mockStorage, {
        customField: 'customValue',
      });

      const context = await managerWithDefaults.getContext('test');
      expect(context.metadata.customField).toBe('customValue');
    });
  });

  describe('getContextById', () => {
    test('should return context by ID', async () => {
      const existingContext: ConversationContext = {
        id: 'test-conversation',
        messages: [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      await mockStorage.set('test-conversation', existingContext);
      const context = await manager.getContextById('test-conversation');

      expect(context).not.toBeNull();
      expect(context?.id).toBe('test-conversation');
    });

    test('should return null when context does not exist', async () => {
      const context = await manager.getContextById('nonexistent');
      expect(context).toBeNull();
    });
  });

  describe('addMessage', () => {
    test('should add message to conversation', async () => {
      const conversationId = 'test-conv';
      const message: Prompt.MessageEncoded = {
        role: 'user',
        content: 'Hello',
      };

      await manager.addMessage(conversationId, message);

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Hello');
    });

    test('should update metadata timestamp when adding message', async () => {
      const conversationId = 'test-conv';
      const message: Prompt.MessageEncoded = {
        role: 'user',
        content: 'Hello',
      };

      const contextBefore = await manager.getContext(conversationId);
      const beforeTime = contextBefore.metadata.updatedAt.getTime();

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.addMessage(conversationId, message);

      const contextAfter = await manager.getContextById(conversationId);
      expect(contextAfter?.metadata.updatedAt.getTime()).toBeGreaterThan(beforeTime);
    });

    test('should append multiple messages in order', async () => {
      const conversationId = 'test-conv';

      await manager.addMessage(conversationId, { role: 'user', content: 'Message 1' });
      await manager.addMessage(conversationId, { role: 'assistant', content: 'Response 1' });
      await manager.addMessage(conversationId, { role: 'user', content: 'Message 2' });

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('Message 1');
      expect(history[1].content).toBe('Response 1');
      expect(history[2].content).toBe('Message 2');
    });

    test('should trim messages based on maxMessages policy', async () => {
      const conversationId = 'caps-messages';
      await manager.setContextPolicy(conversationId, { maxMessages: 2 });

      await manager.addMessage(conversationId, { role: 'user', content: 'Message 1' });
      await manager.addMessage(conversationId, { role: 'assistant', content: 'Message 2' });
      await manager.addMessage(conversationId, { role: 'user', content: 'Message 3' });

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('Message 2');
      expect(history[1].content).toBe('Message 3');
    });

    test('should trim messages based on maxChars policy', async () => {
      const conversationId = 'caps-chars';
      await manager.setContextPolicy(conversationId, { maxChars: 4 });

      await manager.addMessage(conversationId, { role: 'user', content: '12345' });
      await manager.addMessage(conversationId, { role: 'assistant', content: '67890' });
      await manager.addMessage(conversationId, { role: 'user', content: 'abc' });

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('abc');
    });
  });

  describe('addMessages', () => {
    test('should add multiple messages at once', async () => {
      const conversationId = 'test-conv';
      const messages: Prompt.MessageEncoded[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
      ];

      await manager.addMessages(conversationId, messages);

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('Message 1');
      expect(history[1].content).toBe('Response 1');
      expect(history[2].content).toBe('Message 2');
    });

    test('should update metadata timestamp when adding messages', async () => {
      const conversationId = 'test-conv';
      const contextBefore = await manager.getContext(conversationId);
      const beforeTime = contextBefore.metadata.updatedAt.getTime();

      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.addMessages(conversationId, [
        { role: 'user', content: 'Test' },
      ]);

      const contextAfter = await manager.getContextById(conversationId);
      expect(contextAfter?.metadata.updatedAt.getTime()).toBeGreaterThan(beforeTime);
    });

    test('should ignore system messages', async () => {
      const conversationId = 'system-filter';

      await manager.addMessages(conversationId, [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ]);

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
    });
  });

  describe('getHistory', () => {
    test('should return conversation history', async () => {
      const conversationId = 'test-conv';

      await manager.addMessage(conversationId, { role: 'user', content: 'Hello' });
      await manager.addMessage(conversationId, { role: 'assistant', content: 'Hi there' });

      const history = await manager.getHistory(conversationId);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('Hello');
      expect(history[1].content).toBe('Hi there');
    });

    test('should return empty array for new conversation', async () => {
      const history = await manager.getHistory('new-conv');
      expect(history).toEqual([]);
    });
  });

  describe('updateMetadata', () => {
    test('should update conversation metadata', async () => {
      const conversationId = 'test-conv';
      await manager.getContext(conversationId);

      await manager.updateMetadata(conversationId, {
        customField: 'customValue',
        tags: ['tag1', 'tag2'],
      });

      const context = await manager.getContextById(conversationId);
      expect(context?.metadata.customField).toBe('customValue');
      expect(context?.metadata.tags).toEqual(['tag1', 'tag2']);
    });

    test('should preserve existing metadata when updating', async () => {
      const conversationId = 'test-conv';
      const context = await manager.getContext(conversationId);
      const originalCreatedAt = context.metadata.createdAt;

      await manager.updateMetadata(conversationId, {
        customField: 'value',
      });

      const updatedContext = await manager.getContextById(conversationId);
      expect(updatedContext?.metadata.createdAt).toEqual(originalCreatedAt);
      expect(updatedContext?.metadata.customField).toBe('value');
    });

    test('should update timestamp when updating metadata', async () => {
      const conversationId = 'test-conv';
      const contextBefore = await manager.getContext(conversationId);
      const beforeTime = contextBefore.metadata.updatedAt.getTime();

      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.updateMetadata(conversationId, {
        customField: 'value',
      });

      const contextAfter = await manager.getContextById(conversationId);
      expect(contextAfter?.metadata.updatedAt.getTime()).toBeGreaterThan(beforeTime);
    });
  });

  describe('clearContext', () => {
    test('should clear specific conversation context', async () => {
      const conversationId = 'test-conv';
      await manager.addMessage(conversationId, { role: 'user', content: 'Hello' });

      await manager.clearContext(conversationId);

      const context = await manager.getContextById(conversationId);
      expect(context).toBeNull();
    });

    test('should not affect other conversations', async () => {
      const conv1 = 'conv-1';
      const conv2 = 'conv-2';

      await manager.addMessage(conv1, { role: 'user', content: 'Message 1' });
      await manager.addMessage(conv2, { role: 'user', content: 'Message 2' });

      await manager.clearContext(conv1);

      const history1 = await manager.getHistory(conv1);
      const history2 = await manager.getHistory(conv2);

      expect(history1).toHaveLength(0);
      expect(history2).toHaveLength(1);
    });
  });

  describe('resetContext', () => {
    test('should return true when context existed', async () => {
      const conversationId = 'reset-existing';
      await manager.addMessage(conversationId, { role: 'user', content: 'Hello' });

      const result = await manager.resetContext(conversationId);

      expect(result).toBe(true);
      const context = await manager.getContextById(conversationId);
      expect(context).toBeNull();
    });

    test('should return false when context missing', async () => {
      const result = await manager.resetContext('missing');
      expect(result).toBe(false);
    });
  });

  describe('clearAll', () => {
    test('should clear all conversation contexts', async () => {
      await manager.addMessage('conv-1', { role: 'user', content: 'Message 1' });
      await manager.addMessage('conv-2', { role: 'user', content: 'Message 2' });
      await manager.addMessage('conv-3', { role: 'user', content: 'Message 3' });

      await manager.clearAll();

      const context1 = await manager.getContextById('conv-1');
      const context2 = await manager.getContextById('conv-2');
      const context3 = await manager.getContextById('conv-3');

      expect(context1).toBeNull();
      expect(context2).toBeNull();
      expect(context3).toBeNull();
    });
  });

  describe('setStorage', () => {
    test('should allow setting custom storage', async () => {
      const customStorage = createMockStorage();
      manager.setStorage(customStorage);

      await manager.addMessage('test-conv', { role: 'user', content: 'Hello' });

      const context = await manager.getContextById('test-conv');
      expect(context).not.toBeNull();
      expect(context?.messages[0].content).toBe('Hello');
    });

    test('should use new storage after setting', async () => {
      const storage1 = createMockStorage();
      const storage2 = createMockStorage();

      manager.setStorage(storage1);
      await manager.addMessage('test-conv', { role: 'user', content: 'Message 1' });

      manager.setStorage(storage2);
      const context = await manager.getContextById('test-conv');
      expect(context).toBeNull(); // New storage is empty
    });
  });
});
