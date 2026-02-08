import { HookType, HookEvent, HookResult, HookHandler } from './types';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { getActiveSpan, setActiveSpan } from '../tracing/context';
import type { ObservabilityService } from '../observability/service';
import { Effect } from 'effect';

/**
 * Hook execution outcome for telemetry
 */
type HookOutcome = 'executed' | 'skipped' | 'aborted' | 'modified' | 'error';

/**
 * Hook manager for registering and executing hooks
 */
export class HookManager {
  private hooks: Map<HookType, HookHandler[]> = new Map();
  private tracer?: Tracer;
  private observability?: ObservabilityService;

  /**
   * Set the tracer for hook execution tracing
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Set the observability service for telemetry
   */
  setObservability(observability?: ObservabilityService): void {
    this.observability = observability;
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

    const startTime = Date.now();

    // Wire exportTrace function into hook correlation context
    if (this.observability && event.runId) {
      const exportTraceFn = async (traceIdOverride?: string) => {
        if (traceIdOverride !== undefined && traceIdOverride !== event.traceId) {
          return undefined;
        }

        return Effect.runPromise(
          this.observability!.exportTrace(event.runId!)
        );
      };

      event.correlation = {
        runId: event.runId,
        conversationId: event.conversationId,
        intentId: event.intentId,
        agentId: event.agentId,
        timestamp: event.timestamp,
        traceId: event.traceId,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId,
        pipelineId: event.pipelineId,
        stepName: event.stepName,
        exportTrace: exportTraceFn,
      };
    }

    // Log hook execution start
    if (this.observability) {
      await Effect.runPromise(
        this.observability.logStructured({
          level: 'debug',
          message: `Executing hooks: ${type}`,
          metadata: {
            'hook.type': type,
            'hook.handlerCount': handlers.length,
            runId: event.runId,
            conversationId: event.conversationId,
            intentId: event.intentId,
            agentId: event.agentId,
            pipelineId: event.pipelineId,
            stepName: event.stepName,
          },
        })
      );
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
    const outcomes: Record<HookOutcome, number> = {
      executed: 0,
      skipped: 0,
      aborted: 0,
      modified: 0,
      error: 0,
    };

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

            // Classify outcome
            let outcome: HookOutcome = 'executed';
            if (result.skip) {
              outcome = 'skipped';
            } else if (result.abort) {
              outcome = 'aborted';
            } else if (result.data !== undefined || result.context !== undefined || result.metadata !== undefined) {
              outcome = 'modified';
            }
            outcomes[outcome]++;

            if (handlerSpan) {
              handlerSpan.setAttribute('hook.result.hasData', result.data !== undefined);
              handlerSpan.setAttribute('hook.result.hasContext', result.context !== undefined);
              handlerSpan.setAttribute('hook.result.skip', result.skip ?? false);
              handlerSpan.setAttribute('hook.result.abort', result.abort ?? false);
              handlerSpan.setAttribute('hook.outcome', outcome);
              handlerSpan.setStatus('ok');
            }

            // Hash payloads in telemetry
            if (this.observability && result.data !== undefined) {
              const dataHash = await Effect.runPromise(
                this.observability.hashPayload(result.data)
              );
              if (handlerSpan) {
                handlerSpan.setAttribute('hook.result.dataHash', dataHash);
              }
            }
          } else {
            outcomes.executed++;
            if (handlerSpan) {
              handlerSpan.setAttribute('hook.outcome', 'executed');
              handlerSpan.setStatus('ok');
            }
          }
        } catch (error) {
          outcomes.error++;

          // Only log errors in non-test environments to avoid noise in test output
          // Errors are still tracked via tracing spans and telemetry
          if (process.env.NODE_ENV !== 'test') {
            console.error(`Error executing hook ${type}:`, error);
          }
          if (handlerSpan && error instanceof Error) {
            handlerSpan.recordException(error);
            handlerSpan.setAttribute('hook.outcome', 'error');
            handlerSpan.setStatus('error', error.message);
          }
          // Continue executing other hooks even if one fails
        } finally {
          handlerSpan?.end();
        }
      }

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      if (hookSpan) {
        hookSpan.setAttribute('hook.resultsCount', results.length);
        hookSpan.setAttribute('hook.durationMs', durationMs);
        Object.entries(outcomes).forEach(([outcome, count]) => {
          hookSpan.setAttribute(`hook.outcome.${outcome}`, count);
        });
        hookSpan.setStatus('ok');
      }

      // Log hook execution completion
      if (this.observability) {
        await Effect.runPromise(
          this.observability.logStructured({
            level: 'debug',
            message: `Completed hooks: ${type}`,
            metadata: {
              'hook.type': type,
              'hook.durationMs': durationMs,
              'hook.resultsCount': results.length,
              'hook.outcomes': outcomes,
              runId: event.runId,
              conversationId: event.conversationId,
              intentId: event.intentId,
              agentId: event.agentId,
              pipelineId: event.pipelineId,
              stepName: event.stepName,
            },
          })
        );

        // Record hook event metric
        await Effect.runPromise(
          this.observability.recordHookEvent(type)
        );
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
