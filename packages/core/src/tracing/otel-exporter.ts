import { Tracer } from './tracer';
import { Span } from './tracer';
import { OpenTelemetryTracer } from './otel-tracer';

/**
 * Create an OpenTelemetry tracer if available
 * Returns undefined if @opentelemetry/api is not installed
 */
export function createOpenTelemetryTracer(): Tracer | undefined {
  try {
    // Try to require OpenTelemetry API
    require.resolve('@opentelemetry/api');
    return new OpenTelemetryTracer();
  } catch {
    // OpenTelemetry not available
    return undefined;
  }
}

/**
 * Check if OpenTelemetry is available
 */
export function isOpenTelemetryAvailable(): boolean {
  try {
    require.resolve('@opentelemetry/api');
    return true;
  } catch {
    return false;
  }
}

/**
 * Export Fred spans to OpenTelemetry
 * This is a convenience function that creates an OpenTelemetry tracer
 * and can be used to export existing spans
 */
export function exportToOpenTelemetry(tracer: Tracer): Tracer | undefined {
  const otelTracer = createOpenTelemetryTracer();
  if (!otelTracer) {
    console.warn('OpenTelemetry not available. Install @opentelemetry/api to use OpenTelemetry export.');
    return undefined;
  }
  return otelTracer;
}
