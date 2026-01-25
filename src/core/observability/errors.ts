/**
 * Error taxonomy, classification, and redaction utilities for observability.
 *
 * Provides error severity mapping, span status handling, and payload redaction
 * to ensure safe and meaningful error logging in traces and logs.
 *
 * @module src/core/observability/errors
 */

import { Effect, LogLevel } from 'effect';
import type { Span } from '../tracing/types';

/**
 * Error classification categories for Fred errors.
 */
export enum ErrorClass {
  /** Transient errors that can be retried (network timeouts, rate limits) */
  RETRYABLE = 'retryable',
  /** User input errors (validation failures, invalid requests) */
  USER = 'user',
  /** Provider/model errors (API errors, quota exceeded) */
  PROVIDER = 'provider',
  /** Infrastructure errors (database connection, system failures) */
  INFRASTRUCTURE = 'infrastructure',
  /** Unknown/unclassified errors */
  UNKNOWN = 'unknown',
}

/**
 * Map error class to OpenTelemetry span status code.
 */
export function errorClassToSpanStatus(errorClass: ErrorClass): 'ok' | 'error' {
  switch (errorClass) {
    case ErrorClass.USER:
      // User errors are not system errors - mark span as ok
      return 'ok';
    case ErrorClass.RETRYABLE:
    case ErrorClass.PROVIDER:
    case ErrorClass.INFRASTRUCTURE:
    case ErrorClass.UNKNOWN:
      // System errors - mark span as error
      return 'error';
  }
}

/**
 * Map error class to Effect log level.
 */
export function errorClassToLogLevel(errorClass: ErrorClass): LogLevel.LogLevel {
  switch (errorClass) {
    case ErrorClass.USER:
      // User errors are warnings (expected behavior)
      return LogLevel.Warning;
    case ErrorClass.RETRYABLE:
      // Retryable errors logged at warning (may succeed on retry)
      return LogLevel.Warning;
    case ErrorClass.PROVIDER:
    case ErrorClass.INFRASTRUCTURE:
      // Provider and infrastructure errors are system errors
      return LogLevel.Error;
    case ErrorClass.UNKNOWN:
      // Unknown errors logged at error level
      return LogLevel.Error;
  }
}

/**
 * Classify an error based on its properties.
 */
export function classifyError(error: Error): ErrorClass {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Check for retryable errors
  if (
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    name.includes('timeout')
  ) {
    return ErrorClass.RETRYABLE;
  }

  // Check for user errors
  if (
    message.includes('validation') ||
    message.includes('invalid input') ||
    message.includes('bad request') ||
    message.includes('400') ||
    name.includes('validation')
  ) {
    return ErrorClass.USER;
  }

  // Check for provider errors
  if (
    message.includes('api key') ||
    message.includes('quota exceeded') ||
    message.includes('provider') ||
    message.includes('model') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return ErrorClass.PROVIDER;
  }

  // Check for infrastructure errors
  if (
    message.includes('database') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('storage') ||
    name.includes('database')
  ) {
    return ErrorClass.INFRASTRUCTURE;
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Redaction filter function type.
 * Returns redacted version of the payload or null to remove entirely.
 */
export type RedactionFilter = (payload: unknown, context: RedactionContext) => unknown | null;

/**
 * Context for redaction decisions.
 */
export interface RedactionContext {
  /** Type of payload being redacted */
  payloadType: 'request' | 'response' | 'error' | 'metadata';
  /** Source of the payload (tool, provider, step) */
  source: string;
  /** Current log level */
  logLevel: LogLevel.LogLevel;
  /** Error class if applicable */
  errorClass?: ErrorClass;
}

/**
 * Default redaction filter: removes request/response bodies unless debug level.
 */
export function defaultRedactionFilter(payload: unknown, context: RedactionContext): unknown | null {
  // At debug level, allow everything
  if (context.logLevel === LogLevel.Debug || context.logLevel === LogLevel.Trace) {
    return payload;
  }

  // For request/response payloads, redact at info level and above
  if (context.payloadType === 'request' || context.payloadType === 'response') {
    return '[REDACTED]';
  }

  // For errors, allow message but redact details unless debug
  if (context.payloadType === 'error' && typeof payload === 'object' && payload !== null) {
    const error = payload as any;
    return {
      message: error.message,
      name: error.name,
      // Stack only at debug level
    };
  }

  // Metadata can pass through
  return payload;
}

/**
 * Redact a payload using the provided filter.
 */
export function redact(
  payload: unknown,
  context: RedactionContext,
  filter: RedactionFilter = defaultRedactionFilter
): unknown {
  try {
    return filter(payload, context);
  } catch (err) {
    // Redaction failed - return safe placeholder
    console.warn('[Redaction] Failed to redact payload:', err);
    return '[REDACTION_ERROR]';
  }
}

/**
 * Attach error metadata to a span with classification.
 */
export function attachErrorToSpan(
  span: Span,
  error: Error,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): void {
  const errorClass = options?.errorClass ?? classifyError(error);
  const spanStatus = errorClassToSpanStatus(errorClass);

  // Set span status
  span.setStatus(spanStatus, error.message);

  // Add error attributes
  span.setAttributes({
    'error.class': errorClass,
    'error.type': error.name,
    'error.message': error.message,
  });

  // Add custom metadata if provided
  if (options?.metadata) {
    span.setAttributes(options.metadata);
  }

  // Record exception event (includes stack trace)
  if (options?.includeStack !== false) {
    span.recordException(error);
  }
}

/**
 * Log error with Effect logging and appropriate level.
 */
export function logError(
  error: Error,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): Effect.Effect<void> {
  const errorClass = options?.errorClass ?? classifyError(error);
  const logLevel = errorClassToLogLevel(errorClass);

  const logData = {
    errorClass,
    errorType: error.name,
    errorMessage: error.message,
    ...options?.metadata,
  };

  // Include stack only at debug level or if explicitly requested
  const includeStack = options?.includeStack ?? false;
  if (includeStack) {
    (logData as any).stack = error.stack;
  }

  // Log at appropriate level
  switch (logLevel) {
    case LogLevel.Warning:
      return Effect.logWarning(error.message).pipe(
        Effect.annotateLogs(logData)
      );
    case LogLevel.Error:
      return Effect.logError(error.message).pipe(
        Effect.annotateLogs(logData)
      );
    case LogLevel.Fatal:
      return Effect.logFatal(error.message).pipe(
        Effect.annotateLogs(logData)
      );
    default:
      return Effect.logInfo(error.message).pipe(
        Effect.annotateLogs(logData)
      );
  }
}

/**
 * Combined error handling: attach to span and log.
 */
export function handleError(
  error: Error,
  span: Span,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): Effect.Effect<void> {
  // Attach to span
  attachErrorToSpan(span, error, options);

  // Log the error
  return logError(error, options);
}
