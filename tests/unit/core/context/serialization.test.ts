import { describe, test, expect } from 'bun:test';
import {
  serializeMessage,
  deserializeMessage,
  serializeMetadata,
  deserializeMetadata,
} from '../../../../src/core/context/storage/serialization';
import type { ConversationMetadata } from '../../../../src/core/context/context';

// Helper to create a mock Prompt message matching @effect/ai structure
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

function createFilePart(data: string | Uint8Array | URL, mediaType: string) {
  return {
    [PartTypeId]: PartTypeId,
    type: 'file' as const,
    mediaType,
    data,
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

describe('Message Serialization', () => {
  describe('serializeMessage / deserializeMessage', () => {
    test('round-trips a simple text user message', () => {
      const message = createUserMessage([createTextPart('Hello, world!')]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      expect(deserialized).toEqual(message);
    });

    test('round-trips a system message', () => {
      const message = createSystemMessage('You are a helpful assistant.');

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      expect(deserialized).toEqual(message);
    });

    test('round-trips an assistant message with tool call', () => {
      const message = createAssistantMessage([
        createTextPart('Let me check that for you.'),
        createToolCallPart('call_123', 'get_weather', { city: 'London' }),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      expect(deserialized).toEqual(message);
    });

    test('round-trips an assistant message with tool result', () => {
      const message = createAssistantMessage([
        createToolResultPart('call_123', 'get_weather', {
          temperature: 18,
          condition: 'cloudy',
        }),
        createTextPart('The weather in London is 18C and cloudy.'),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      expect(deserialized).toEqual(message);
    });

    test('round-trips a message with Uint8Array file data', () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const message = createUserMessage([
        createTextPart('Here is an image:'),
        createFilePart(binaryData, 'image/png'),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      // Check the binary data was preserved
      const fileContent = (deserialized as any).content[1];
      expect(fileContent.data).toBeInstanceOf(Uint8Array);
      expect(fileContent.data).toEqual(binaryData);
    });

    test('round-trips a message with URL file data', () => {
      const url = new URL('https://example.com/image.png');
      const message = createUserMessage([
        createTextPart('Check this image:'),
        createFilePart(url, 'image/png'),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      const fileContent = (deserialized as any).content[1];
      expect(fileContent.data).toBeInstanceOf(URL);
      expect(fileContent.data.href).toBe('https://example.com/image.png');
    });

    test('round-trips a message with base64 string file data', () => {
      const base64Data = 'data:image/png;base64,iVBORw0KGgo=';
      const message = createUserMessage([
        createFilePart(base64Data, 'image/png'),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      const fileContent = (deserialized as any).content[0];
      expect(fileContent.data).toBe(base64Data);
    });

    test('accepts pre-parsed object input (Postgres JSONB)', () => {
      const message = createUserMessage([createTextPart('Test message')]);

      const serialized = serializeMessage(message as any);
      const parsedPayload = JSON.parse(serialized.payload);

      // Simulate Postgres returning parsed JSONB
      const deserialized = deserializeMessage(parsedPayload);

      expect(deserialized).toEqual(message);
    });

    test('handles nested complex tool params', () => {
      const message = createAssistantMessage([
        createToolCallPart('call_456', 'search', {
          query: 'typescript tutorials',
          filters: {
            date: new Date('2024-01-15'),
            sources: ['docs', 'blog'],
          },
          limit: 10,
        }),
      ]);

      const serialized = serializeMessage(message as any);
      const deserialized = deserializeMessage(serialized.payload);

      const toolCall = (deserialized as any).content[0];
      expect(toolCall.params.filters.date).toBeInstanceOf(Date);
      expect(toolCall.params.filters.date.toISOString()).toBe(
        '2024-01-15T00:00:00.000Z'
      );
    });
  });
});

describe('Metadata Serialization', () => {
  describe('serializeMetadata / deserializeMetadata', () => {
    test('round-trips basic metadata with dates', () => {
      const createdAt = new Date('2024-01-10T10:00:00Z');
      const updatedAt = new Date('2024-01-15T14:30:00Z');

      const metadata: ConversationMetadata = {
        createdAt,
        updatedAt,
      };

      const serialized = serializeMetadata(metadata);

      expect(serialized.createdAt).toBe('2024-01-10T10:00:00.000Z');
      expect(serialized.updatedAt).toBe('2024-01-15T14:30:00.000Z');
      expect(serialized.metadata).toBe('{}');

      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        serialized.metadata
      );

      expect(deserialized.createdAt).toBeInstanceOf(Date);
      expect(deserialized.updatedAt).toBeInstanceOf(Date);
      expect(deserialized.createdAt.toISOString()).toBe(
        '2024-01-10T10:00:00.000Z'
      );
      expect(deserialized.updatedAt.toISOString()).toBe(
        '2024-01-15T14:30:00.000Z'
      );
    });

    test('round-trips metadata with policy', () => {
      const metadata: ConversationMetadata = {
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        policy: {
          maxMessages: 100,
          maxChars: 50000,
          strict: true,
          isolated: false,
        },
      };

      const serialized = serializeMetadata(metadata);
      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        serialized.metadata
      );

      expect(deserialized.policy).toEqual(metadata.policy);
    });

    test('round-trips metadata with custom fields', () => {
      const metadata: ConversationMetadata = {
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        userId: 'user_123',
        sessionId: 'sess_456',
        tags: ['support', 'billing'],
        priority: 'high',
      };

      const serialized = serializeMetadata(metadata);
      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        serialized.metadata
      );

      expect(deserialized.userId).toBe('user_123');
      expect(deserialized.sessionId).toBe('sess_456');
      expect(deserialized.tags).toEqual(['support', 'billing']);
      expect(deserialized.priority).toBe('high');
    });

    test('handles Date in custom metadata fields', () => {
      const lastActive = new Date('2024-01-14T09:00:00Z');
      const metadata: ConversationMetadata = {
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        lastActive,
      };

      const serialized = serializeMetadata(metadata);
      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        serialized.metadata
      );

      expect(deserialized.lastActive).toBeInstanceOf(Date);
      expect((deserialized.lastActive as Date).toISOString()).toBe(
        '2024-01-14T09:00:00.000Z'
      );
    });

    test('handles URL in custom metadata fields', () => {
      const metadata: ConversationMetadata = {
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        callbackUrl: new URL('https://example.com/webhook'),
      };

      const serialized = serializeMetadata(metadata);
      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        serialized.metadata
      );

      expect(deserialized.callbackUrl).toBeInstanceOf(URL);
      expect((deserialized.callbackUrl as URL).href).toBe(
        'https://example.com/webhook'
      );
    });

    test('accepts Date objects for timestamp inputs', () => {
      const createdAt = new Date('2024-01-10T10:00:00Z');
      const updatedAt = new Date('2024-01-15T14:30:00Z');

      const deserialized = deserializeMetadata(createdAt, updatedAt, '{}');

      expect(deserialized.createdAt).toBe(createdAt);
      expect(deserialized.updatedAt).toBe(updatedAt);
    });

    test('accepts pre-parsed object for metadata (Postgres JSONB)', () => {
      const metadata: ConversationMetadata = {
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        userId: 'user_123',
      };

      const serialized = serializeMetadata(metadata);
      const parsedMetadata = JSON.parse(serialized.metadata);

      // Simulate Postgres returning parsed JSONB
      const deserialized = deserializeMetadata(
        serialized.createdAt,
        serialized.updatedAt,
        parsedMetadata
      );

      expect(deserialized.userId).toBe('user_123');
    });
  });
});
