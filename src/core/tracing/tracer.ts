import { SpanOptions, SpanContext } from './types';

/**
 * Core tracer interface
 * Provides a lightweight tracing abstraction without hard OpenTelemetry dependency
 */
export interface Tracer {
  /**
   * Start a new span
   * @param name - Span name
   * @param options - Span options (kind, attributes, start time)
   * @returns A new span instance
   */
  startSpan(name: string, options?: SpanOptions): Span;

  /**
   * Get the currently active span
   * @returns The active span or undefined if none
   */
  getActiveSpan(): Span | undefined;

  /**
   * Set the active span (for context propagation)
   * @param span - The span to set as active
   */
  setActiveSpan(span: Span | undefined): void;

  /**
   * Get the current trace ID
   * @returns The trace ID or undefined if no active trace
   */
  getTraceId(): string | undefined;
}

/**
 * Span interface representing a single operation
 */
export interface Span {
  /**
   * Span name
   */
  readonly name: string;

  /**
   * Span context for propagation
   */
  readonly context: SpanContext;

  /**
   * Set an attribute on the span
   * @param key - Attribute key
   * @param value - Attribute value
   */
  setAttribute(key: string, value: string | number | boolean | string[] | number[] | boolean[]): void;

  /**
   * Set multiple attributes at once
   * @param attributes - Object with attribute key-value pairs
   */
  setAttributes(attributes: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;

  /**
   * Add an event to the span
   * @param name - Event name
   * @param attributes - Optional event attributes
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;

  /**
   * Record an exception on the span
   * @param error - The error/exception
   * @param attributes - Optional additional attributes
   */
  recordException(error: Error, attributes?: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;

  /**
   * Set the span status
   * @param status - Status code (ok, error, unset)
   * @param message - Optional status message
   */
  setStatus(status: 'ok' | 'error' | 'unset', message?: string): void;

  /**
   * Update the span name
   * @param name - New span name
   */
  updateName(name: string): void;

  /**
   * End the span and record timing
   * @param endTime - Optional end time (defaults to now)
   */
  end(endTime?: number): void;

  /**
   * Check if the span is ended
   */
  isEnded(): boolean;

  /**
   * Get span start time
   */
  getStartTime(): number;

  /**
   * Get span end time (if ended)
   */
  getEndTime(): number | undefined;

  /**
   * Get span duration (if ended)
   */
  getDuration(): number | undefined;
}
