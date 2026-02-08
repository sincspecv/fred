/**
 * OpenTelemetry observability layer factory using Effect's built-in logging and tracing.
 *
 * Provides Effect logger and tracer layers with OTLP exporter support.
 * Handles resource metadata (service name/version/environment) and defaults gracefully
 * when OTLP is not configured.
 *
 * @module src/core/observability/otel
 */

import { Effect, Layer, Logger, LogLevel } from 'effect';
import * as NodeSdk from '@effect/opentelemetry/NodeSdk';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/**
 * Observability configuration options
 */
export interface ObservabilityConfig {
  /** OTLP exporter endpoint (e.g., 'http://localhost:4318/v1/traces') */
  otlp?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };

  /** Minimum log level override (defaults to debug in dev, info in prod) */
  logLevel?: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

  /** Resource attributes attached to all spans and logs */
  resource?: {
    serviceName?: string;
    serviceVersion?: string;
    environment?: string;
    [key: string]: unknown;
  };

  /** Enable console exporter as fallback when OTLP is not configured */
  enableConsoleFallback?: boolean;

  /** Per-run verbosity overrides for controlling high-volume events */
  verbosity?: VerbosityOverrides;
}

/**
 * Verbosity override settings for controlling event volume.
 */
export interface VerbosityOverrides {
  /** Gate token stream events to debug level (default: true) */
  gateTokenStreams?: boolean;

  /** Gate heartbeat events to debug level (default: true) */
  gateHeartbeats?: boolean;

  /** Minimum level for high-volume events when not gated (default: info) */
  highVolumeLevel?: 'debug' | 'info';
}

/**
 * Observability layers for the Effect runtime.
 * Includes tracer and logger layers with OTLP exporter wiring.
 */
export interface ObservabilityLayers {
  /** Combined layer for tracer provider */
  tracerLayer: Layer.Layer<never>;

  /** Logger layer with minimum log level applied */
  loggerLayer: Layer.Layer<never>;
}

/**
 * Convert config log level string to Effect LogLevel.
 */
function toLogLevel(level: string | undefined, isDevelopment: boolean): LogLevel.LogLevel {
  if (!level) {
    return isDevelopment ? LogLevel.Debug : LogLevel.Info;
  }

  const levelMap: Record<string, LogLevel.LogLevel> = {
    trace: LogLevel.Trace,
    debug: LogLevel.Debug,
    info: LogLevel.Info,
    warning: LogLevel.Warning,
    error: LogLevel.Error,
    fatal: LogLevel.Fatal,
  };

  return levelMap[level.toLowerCase()] ?? (isDevelopment ? LogLevel.Debug : LogLevel.Info);
}

/**
 * Build observability layers from configuration.
 *
 * Returns Effect logger and tracer layers with OTLP exporter support.
 * When OTLP is not configured, falls back to console exporter (if enabled)
 * or no-op tracer (spans still created but not exported).
 *
 * @param config - Observability configuration
 * @returns Observability layers ready for Effect runtime
 *
 * @example
 * ```typescript
 * const { tracerLayer, loggerLayer } = buildObservabilityLayers({
 *   otlp: { endpoint: 'http://localhost:4318/v1/traces' },
 *   logLevel: 'debug',
 *   resource: { serviceName: 'fred', serviceVersion: '0.1.2' }
 * });
 *
 * const program = Effect.withSpan("my-operation")(Effect.succeed("done"));
 * Effect.runPromise(program.pipe(
 *   Effect.provide(tracerLayer),
 *   Effect.provide(loggerLayer)
 * ));
 * ```
 */
export function buildObservabilityLayers(config: ObservabilityConfig = {}): ObservabilityLayers {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const minLevel = toLogLevel(config.logLevel, isDevelopment);

  // Build resource attributes
  const resource = {
    serviceName: config.resource?.serviceName ?? 'fred',
    serviceVersion: config.resource?.serviceVersion ?? '0.1.2',
    environment: config.resource?.environment ?? (isDevelopment ? 'development' : 'production'),
    ...config.resource,
  };

  // Remove undefined values from resource
  const cleanResource = Object.fromEntries(
    Object.entries(resource).filter(([_, v]) => v !== undefined)
  ) as Record<string, string>;

  // Build tracer layer
  let tracerLayer: Layer.Layer<never>;

  // Build properly-typed resource object
  const resourceConfig = {
    serviceName: resource.serviceName,
    serviceVersion: resource.serviceVersion,
    attributes: cleanResource as Record<string, string | number | boolean | string[]>,
  };

  if (config.otlp?.endpoint) {
    // OTLP exporter configured - use OTLP HTTP exporter
    const otlpExporter = new OTLPTraceExporter({
      url: config.otlp.endpoint,
      headers: config.otlp.headers ?? {},
    });

    tracerLayer = NodeSdk.layer(() => ({
      resource: resourceConfig,
      spanProcessor: new BatchSpanProcessor(otlpExporter),
    })) as Layer.Layer<never>;
  } else if (config.enableConsoleFallback ?? isDevelopment) {
    // No OTLP, but console fallback enabled (default in dev)
    tracerLayer = NodeSdk.layer(() => ({
      resource: resourceConfig,
      spanProcessor: new BatchSpanProcessor(new ConsoleSpanExporter()),
    })) as Layer.Layer<never>;
  } else {
    // No OTLP, no console fallback - use empty layer
    // Spans are still created but not exported (low overhead)
    tracerLayer = NodeSdk.layerEmpty as Layer.Layer<never>;
  }

  // Build logger layer with JSON output and minimum log level
  const loggerLayer = Layer.mergeAll(
    Logger.json,
    Logger.minimumLogLevel(minLevel)
  );

  return {
    tracerLayer,
    loggerLayer,
  };
}

/**
 * Annotate the current span with common Fred identifiers.
 *
 * Attaches runId, conversationId, workflowId, stepName, and other metadata
 * to the active span for observability correlation.
 *
 * @param metadata - Metadata to attach to current span
 * @returns Effect that annotates the current span
 *
 * @example
 * ```typescript
 * const program = Effect.withSpan("pipeline.step")(
 *   annotateSpan({
 *     runId: 'run-123',
 *     workflowId: 'support',
 *     stepName: 'validate',
 *     attempt: 1
 *   }).pipe(
 *     Effect.flatMap(() => Effect.logDebug("processing step"))
 *   )
 * );
 * ```
 */
export function annotateSpan(metadata: {
  runId?: string;
  conversationId?: string;
  workflowId?: string;
  stepName?: string;
  attempt?: number;
  toolId?: string;
  provider?: string;
  agentId?: string;
  [key: string]: unknown;
}): Effect.Effect<void> {
  // Filter out undefined values
  const cleanMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([_, v]) => v !== undefined)
  );

  return Effect.annotateCurrentSpan(cleanMetadata);
}

/**
 * Helper to create a span with Fred metadata attached.
 *
 * @param name - Span name
 * @param metadata - Metadata to attach (runId, workflowId, etc.)
 * @returns Effect that creates a span with metadata
 *
 * @example
 * ```typescript
 * const program = withFredSpan("tool.call", { runId: 'run-123', toolId: 'search' })(
 *   Effect.logDebug("invoking tool").pipe(
 *     Effect.flatMap(() => callTool())
 *   )
 * );
 * ```
 */
export function withFredSpan<A, E, R>(
  name: string,
  metadata: Parameters<typeof annotateSpan>[0]
): (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return (effect) =>
    Effect.withSpan(name)(
      annotateSpan(metadata).pipe(Effect.flatMap(() => effect))
    );
}

/**
 * Check if an event should be logged based on verbosity settings.
 *
 * High-volume events (token streams, heartbeats) are gated to debug level
 * unless verbosity overrides allow them at info level.
 *
 * @param eventType - Type of event being logged
 * @param currentLevel - Current log level
 * @param verbosity - Verbosity override settings
 * @returns True if event should be logged at current level
 */
export function shouldLogEvent(
  eventType: 'token' | 'heartbeat' | 'summary' | 'other',
  currentLevel: LogLevel.LogLevel,
  verbosity?: VerbosityOverrides
): boolean {
  // Summary and other events always log
  if (eventType === 'summary' || eventType === 'other') {
    return true;
  }

  // Default verbosity: gate high-volume events
  const gateTokens = verbosity?.gateTokenStreams ?? true;
  const gateHeartbeats = verbosity?.gateHeartbeats ?? true;
  const highVolumeLevel = verbosity?.highVolumeLevel ?? 'info';

  // Check if current level is debug/trace
  const isDebugOrTrace =
    currentLevel === LogLevel.Debug || currentLevel === LogLevel.Trace;

  // Token stream gating
  if (eventType === 'token') {
    if (gateTokens) {
      // Only log at debug/trace
      return isDebugOrTrace;
    } else {
      // Log at high volume level or higher
      return isDebugOrTrace || highVolumeLevel === 'info';
    }
  }

  // Heartbeat gating
  if (eventType === 'heartbeat') {
    if (gateHeartbeats) {
      // Only log at debug/trace
      return isDebugOrTrace;
    } else {
      // Log at high volume level or higher
      return isDebugOrTrace || highVolumeLevel === 'info';
    }
  }

  return true;
}

/**
 * Get the effective log level from config and environment.
 *
 * Environment variables override config values:
 * - FRED_LOG_LEVEL: Overall log level
 * - NODE_ENV: Development vs production defaults
 *
 * @param config - Observability configuration
 * @returns Effective log level
 */
export function getEffectiveLogLevel(config: ObservabilityConfig = {}): LogLevel.LogLevel {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const envLevel = process.env.FRED_LOG_LEVEL;

  // Environment variable takes precedence
  if (envLevel) {
    return toLogLevel(envLevel, isDevelopment);
  }

  // Then config
  return toLogLevel(config.logLevel, isDevelopment);
}
