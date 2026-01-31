import { Context, Effect, Layer, Ref } from 'effect';
import type { HookType, HookEvent, HookResult, HookHandler } from './types';

/**
 * Error thrown when hook execution encounters catastrophic failure
 */
export class HookExecutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'HookExecutionError';
  }
}

/**
 * HookManagerService interface for Effect-based hook management
 */
export interface HookManagerService {
  /**
   * Register a hook handler for a specific hook type
   */
  registerHook(type: HookType, handler: HookHandler): Effect.Effect<void>;

  /**
   * Unregister a hook handler
   */
  unregisterHook(type: HookType, handler: HookHandler): Effect.Effect<boolean>;

  /**
   * Execute all hooks of a given type
   * Returns results from all handlers, continues even if one fails
   */
  executeHooks(type: HookType, event: HookEvent): Effect.Effect<HookResult[], HookExecutionError>;

  /**
   * Execute hooks and merge results into single context/data object
   */
  executeHooksAndMerge(type: HookType, event: HookEvent): Effect.Effect<{
    context?: Record<string, unknown>;
    data?: unknown;
    skip?: boolean;
    metadata?: Record<string, unknown>;
  }, HookExecutionError>;

  /**
   * Clear all hooks of a specific type
   */
  clearHooks(type: HookType): Effect.Effect<void>;

  /**
   * Clear all hooks
   */
  clearAllHooks(): Effect.Effect<void>;

  /**
   * Get all registered hook types
   */
  getRegisteredHookTypes(): Effect.Effect<HookType[]>;

  /**
   * Get count of handlers for a hook type
   */
  getHookCount(type: HookType): Effect.Effect<number>;
}

export const HookManagerService = Context.GenericTag<HookManagerService>(
  'HookManagerService'
);

/**
 * Implementation of HookManagerService
 */
class HookManagerServiceImpl implements HookManagerService {
  constructor(private hooks: Ref.Ref<Map<HookType, HookHandler[]>>) {}

  registerHook(type: HookType, handler: HookHandler): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const newHooks = new Map(hooks);
      const handlers = newHooks.get(type) || [];
      newHooks.set(type, [...handlers, handler]);
      yield* Ref.set(self.hooks, newHooks);
    });
  }

  unregisterHook(type: HookType, handler: HookHandler): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const handlers = hooks.get(type);
      if (!handlers) return false;

      const index = handlers.indexOf(handler);
      if (index === -1) return false;

      const newHooks = new Map(hooks);
      const newHandlers = [...handlers];
      newHandlers.splice(index, 1);
      newHooks.set(type, newHandlers);
      yield* Ref.set(self.hooks, newHooks);
      return true;
    });
  }

  executeHooks(type: HookType, event: HookEvent): Effect.Effect<HookResult[], HookExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const handlers = hooks.get(type);
      if (!handlers || handlers.length === 0) return [];

      const results: HookResult[] = [];

      for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];

        // Execute the handler (may return Promise or value) with error catching
        const resultOrPromise = handler(event);
        const handlerEffect = resultOrPromise instanceof Promise
          ? Effect.tryPromise({
              try: () => resultOrPromise,
              catch: (error) => error,
            })
          : Effect.try({
              try: () => resultOrPromise,
              catch: (error) => error,
            });

        const result = yield* handlerEffect.pipe(
          Effect.catchAll((error) => {
            // Log but continue - hooks should not block execution
            if (process.env.NODE_ENV !== 'test') {
              console.error(`Error executing hook ${type}:`, error);
            }
            // Return succeed with undefined to continue execution
            return Effect.succeed(undefined);
          })
        );

        if (result) {
          results.push(result);
        }
      }

      return results;
    });
  }

  executeHooksAndMerge(type: HookType, event: HookEvent): Effect.Effect<{
    context?: Record<string, unknown>;
    data?: unknown;
    skip?: boolean;
    metadata?: Record<string, unknown>;
  }, HookExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const results = yield* self.executeHooks(type, event);

      const merged: {
        context?: Record<string, unknown>;
        data?: unknown;
        skip?: boolean;
        metadata?: Record<string, unknown>;
      } = {};

      for (const result of results) {
        if (result.context) {
          merged.context = { ...merged.context, ...result.context };
        }
        if (result.data !== undefined) {
          merged.data = result.data;
        }
        if (result.skip) {
          merged.skip = true;
        }
        if (result.metadata) {
          merged.metadata = { ...merged.metadata, ...result.metadata };
        }
      }

      return merged;
    });
  }

  clearHooks(type: HookType): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const newHooks = new Map(hooks);
      newHooks.delete(type);
      yield* Ref.set(self.hooks, newHooks);
    });
  }

  clearAllHooks(): Effect.Effect<void> {
    return Ref.set(this.hooks, new Map());
  }

  getRegisteredHookTypes(): Effect.Effect<HookType[]> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      return Array.from(hooks.keys());
    });
  }

  getHookCount(type: HookType): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      return hooks.get(type)?.length || 0;
    });
  }
}

/**
 * Live layer providing HookManagerService
 */
export const HookManagerServiceLive = Layer.effect(
  HookManagerService,
  Effect.gen(function* () {
    const hooks = yield* Ref.make(new Map<HookType, HookHandler[]>());
    return new HookManagerServiceImpl(hooks);
  })
);
