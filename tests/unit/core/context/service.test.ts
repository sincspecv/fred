import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { ContextStorageService, ContextStorageServiceLive } from '../../../../packages/core/src/context/service';
import { ContextNotFoundError } from '../../../../packages/core/src/context/errors';

const runWithService = <A, E>(effect: Effect.Effect<A, E, ContextStorageService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ContextStorageServiceLive)));

describe('ContextStorageService', () => {
  describe('generateConversationId', () => {
    test('generates unique IDs', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          const id1 = yield* service.generateConversationId();
          const id2 = yield* service.generateConversationId();
          return { id1, id2 };
        })
      );
      expect(result.id1).not.toBe(result.id2);
      expect(result.id1).toMatch(/^conv_/);
    });
  });

  describe('getContext', () => {
    test('creates new context when ID not provided', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          const context = yield* service.getContext();
          return context;
        })
      );
      expect(result.id).toMatch(/^conv_/);
      expect(result.messages).toEqual([]);
    });

    test('returns existing context when found', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          const ctx1 = yield* service.getContext('test-id');
          yield* service.addMessage('test-id', { role: 'user', content: 'hello' });
          const ctx2 = yield* service.getContext('test-id');
          return { ctx1, ctx2 };
        })
      );
      expect(result.ctx1.id).toBe('test-id');
      expect(result.ctx2.messages.length).toBe(1);
    });

    test('fails with ContextNotFoundError in strict mode', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          return yield* service.getContext('nonexistent', { strict: true });
        }).pipe(Effect.provide(ContextStorageServiceLive))
      );
      expect(result._tag).toBe('Failure');
    });
  });

  describe('addMessage', () => {
    test('adds message to context', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          yield* service.getContext('test-id');
          yield* service.addMessage('test-id', { role: 'user', content: 'hello' });
          return yield* service.getHistory('test-id');
        })
      );
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
    });

    test('filters system messages', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          yield* service.getContext('test-id');
          yield* service.addMessage('test-id', { role: 'system', content: 'ignored' });
          yield* service.addMessage('test-id', { role: 'user', content: 'kept' });
          return yield* service.getHistory('test-id');
        })
      );
      expect(result.length).toBe(1);
      expect(result[0].role).toBe('user');
    });
  });

  describe('setDefaultPolicy', () => {
    test('applies maxMessages cap to new contexts', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          yield* service.setDefaultPolicy({ maxMessages: 2 });
          yield* service.getContext('test-id');
          yield* service.addMessage('test-id', { role: 'user', content: 'msg1' });
          yield* service.addMessage('test-id', { role: 'assistant', content: 'msg2' });
          yield* service.addMessage('test-id', { role: 'user', content: 'msg3' });
          return yield* service.getHistory('test-id');
        })
      );
      expect(result.length).toBe(2);
      expect(result[0].content).toBe('msg2');
      expect(result[1].content).toBe('msg3');
    });
  });

  describe('clearContext', () => {
    test('removes context', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          yield* service.getContext('test-id');
          yield* service.clearContext('test-id');
          return yield* service.getContextById('test-id');
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('resetContext', () => {
    test('returns true when context existed', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          yield* service.getContext('test-id');
          return yield* service.resetContext('test-id');
        })
      );
      expect(result).toBe(true);
    });

    test('returns false when context did not exist', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextStorageService;
          return yield* service.resetContext('nonexistent');
        })
      );
      expect(result).toBe(false);
    });
  });
});
