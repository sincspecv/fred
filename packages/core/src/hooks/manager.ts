import { HookType, HookEvent, HookResult, HookHandler } from './types';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { getActiveSpan, setActiveSpan } from '../tracing/context';

/**
 * Hook manager for registering and executing hooks
 */
export class HookManager {
  private hooks: Map<HookType, HookHandler[]> = new Map();
  private tracer?: Tracer;

  /**
   * Set the tracer for hook execution tracing
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Register a hook handler
   */
  registerHook(type: HookType, handler: HookHandler): void {
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }
    this.hooks.get(type)!.push(handler);
  }

  /**
   * Unregister a hook handler
   */
  unregisterHook(type: HookType, handler: HookHandler): boolean {
    const handlers = this.hooks.get(type);
    if (!handlers) {
      return false;
    }
    const index = handlers.indexOf(handler);
    if (index === -1) {
      return false;
    }
    handlers.splice(index, 1);
    return true;
  }

  /**
   * Execute all hooks of a given type
   */
  async executeHooks(type: HookType, event: HookEvent): Promise<HookResult[]> {
    const handlers = this.hooks.get(type);
    if (!handlers || handlers.length === 0) {
      return [];
    }

    // Create span for hook execution if tracing is enabled
    const hookSpan = this.tracer?.startSpan('hook.execute', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'hook.type': type,
        'hook.handlerCount': handlers.length,
      },
    });

    const previousActiveSpan = this.tracer?.getActiveSpan();
    if (hookSpan) {
      this.tracer?.setActiveSpan(hookSpan);
    }

    const results: HookResult[] = [];
    try {
      for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];
        const handlerSpan = this.tracer?.startSpan(`hook.handler.${i}`, {
          kind: SpanKind.INTERNAL,
          attributes: {
            'hook.type': type,
            'hook.handlerIndex': i,
          },
        });

        try {
          const result = await handler(event);
          if (result) {
            results.push(result);
            if (handlerSpan) {
              handlerSpan.setAttribute('hook.result.hasData', result.data !== undefined);
              handlerSpan.setAttribute('hook.result.hasContext', result.context !== undefined);
              handlerSpan.setAttribute('hook.result.skip', result.skip ?? false);
              handlerSpan.setStatus('ok');
            }
          } else if (handlerSpan) {
            handlerSpan.setStatus('ok');
          }
        } catch (error) {
          // Only log errors in non-test environments to avoid noise in test output
          // Errors are still tracked via tracing spans
          if (process.env.NODE_ENV !== 'test') {
            console.error(`Error executing hook ${type}:`, error);
          }
          if (handlerSpan && error instanceof Error) {
            handlerSpan.recordException(error);
            handlerSpan.setStatus('error', error.message);
          }
          // Continue executing other hooks even if one fails
        } finally {
          handlerSpan?.end();
        }
      }

      if (hookSpan) {
        hookSpan.setAttribute('hook.resultsCount', results.length);
        hookSpan.setStatus('ok');
      }
    } catch (error) {
      if (hookSpan && error instanceof Error) {
        hookSpan.recordException(error);
        hookSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      if (hookSpan) {
        hookSpan.end();
        // Restore previous active span
        if (previousActiveSpan) {
          this.tracer?.setActiveSpan(previousActiveSpan);
        } else {
          this.tracer?.setActiveSpan(undefined);
        }
      }
    }

    return results;
  }

  /**
   * Execute hooks and merge results
   * Returns merged context and data from all hook results
   */
  async executeHooksAndMerge(type: HookType, event: HookEvent): Promise<{
    context?: Record<string, any>;
    data?: any;
    skip?: boolean;
    metadata?: Record<string, any>;
  }> {
    const results = await this.executeHooks(type, event);

    // Merge all results
    const merged: {
      context?: Record<string, any>;
      data?: any;
      skip?: boolean;
      metadata?: Record<string, any>;
    } = {};

    for (const result of results) {
      // Merge context
      if (result.context) {
        merged.context = { ...merged.context, ...result.context };
      }

      // Last data wins (hooks executed in order)
      if (result.data !== undefined) {
        merged.data = result.data;
      }

      // Skip if any hook requests it
      if (result.skip) {
        merged.skip = true;
      }

      // Merge metadata
      if (result.metadata) {
        merged.metadata = { ...merged.metadata, ...result.metadata };
      }
    }

    return merged;
  }

  /**
   * Clear all hooks of a specific type
   */
  clearHooks(type: HookType): void {
    this.hooks.delete(type);
  }

  /**
   * Clear all hooks
   */
  clearAllHooks(): void {
    this.hooks.clear();
  }

  /**
   * Get all registered hook types
   */
  getRegisteredHookTypes(): HookType[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Get count of handlers for a hook type
   */
  getHookCount(type: HookType): number {
    return this.hooks.get(type)?.length || 0;
  }
}
