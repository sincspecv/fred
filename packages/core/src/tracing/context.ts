import { Span } from './tracer';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Global AsyncLocalStorage for spans
 * This ensures correct trace propagation across asynchronous operations
 */
const spanStore = new AsyncLocalStorage<Span>();

/**
 * Get the active span from the current async context
 */
export function getActiveSpan(): Span | undefined {
  return spanStore.getStore();
}

/**
 * Set the active span in the current async context
 * Uses enterWith to set the span in the current execution context
 */
export function setActiveSpan(span: Span | undefined): void {
  if (span) {
    spanStore.enterWith(span);
  }
  // Note: To clear a span, use runWithSpan with a new context or let the async operation complete
}

/**
 * Run a function with a span as the active span
 * This is the recommended way to set active spans for async operations
 */
export function runWithSpan<T>(span: Span, fn: () => T): T {
  return spanStore.run(span, fn);
}

/**
 * Run an async function with a span as the active span
 * This is the recommended way to set active spans for async operations
 */
export async function runWithSpanAsync<T>(span: Span, fn: () => Promise<T>): Promise<T> {
  return spanStore.run(span, fn);
}

/**
 * Clear span context (for testing)
 * Note: AsyncLocalStorage doesn't have a direct clear method,
 * but we can exit the current context if we're in one
 */
export function clearSpanContext(): void {
  // AsyncLocalStorage doesn't have a global clear method
  // This is mainly for testing - in practice, contexts are cleared
  // automatically when async operations complete
  // For testing, you can use runWithSpan(undefined, ...) or just let contexts expire
}
