import { Tracer, Span } from './tracer';
import { SpanOptions, SpanContext, SpanStatus } from './types';
import { setActiveSpan, getActiveSpan } from './context';

/**
 * OpenTelemetry tracer implementation
 * Requires @opentelemetry/api to be installed
 */
export class OpenTelemetryTracer implements Tracer {
  private otelTracer: any; // OpenTelemetry Tracer
  private otelApi: any; // OpenTelemetry API
  private traceId: string;

  constructor() {
    // Try to load OpenTelemetry API
    try {
      // Dynamic import to avoid hard dependency
      // In a real implementation, you'd check if it's available
      this.otelApi = require('@opentelemetry/api');
      this.otelTracer = this.otelApi.trace.getTracer('fred');
      this.traceId = this.generateTraceId();
    } catch (error) {
      throw new Error(
        'OpenTelemetry API not found. Install @opentelemetry/api to use OpenTelemetryTracer.'
      );
    }
  }

  private generateTraceId(): string {
    // Generate a trace ID compatible with OpenTelemetry format (32 hex characters)
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  startSpan(name: string, options?: SpanOptions): Span {
    const spanOptions: any = {
      kind: this.mapSpanKind(options?.kind),
      attributes: options?.attributes || {},
      startTime: options?.startTime,
    };

    const otelSpan = this.otelTracer.startSpan(name, spanOptions);
    return new OpenTelemetrySpan(otelSpan, this.traceId, this.otelApi);
  }

  getActiveSpan(): Span | undefined {
    const otelSpan = this.otelApi.trace.getActiveSpan();
    if (!otelSpan) {
      return undefined;
    }
    return new OpenTelemetrySpan(otelSpan, this.traceId, this.otelApi);
  }

  setActiveSpan(span: Span | undefined): void {
    if (span instanceof OpenTelemetrySpan) {
      this.otelApi.trace.setSpan(this.otelApi.context.active(), span.getOtelSpan());
    } else {
      setActiveSpan(span);
    }
  }

  getTraceId(): string | undefined {
    return this.traceId;
  }

  private mapSpanKind(kind?: string): number {
    // Map our SpanKind to OpenTelemetry SpanKind
    if (!kind) {
      return this.otelApi.SpanKind.INTERNAL;
    }

    const kindMap: Record<string, number> = {
      internal: this.otelApi.SpanKind.INTERNAL,
      server: this.otelApi.SpanKind.SERVER,
      client: this.otelApi.SpanKind.CLIENT,
      producer: this.otelApi.SpanKind.PRODUCER,
      consumer: this.otelApi.SpanKind.CONSUMER,
    };

    return kindMap[kind.toLowerCase()] || this.otelApi.SpanKind.INTERNAL;
  }
}

/**
 * OpenTelemetry span wrapper
 */
class OpenTelemetrySpan implements Span {
  private otelSpan: any;
  private traceId: string;
  private otelApi: any;
  readonly name: string;
  readonly context: SpanContext;

  constructor(otelSpan: any, traceId: string, otelApi: any) {
    this.otelSpan = otelSpan;
    this.traceId = traceId;
    this.otelApi = otelApi;
    this.name = otelSpan.name;
    
    const spanContext = otelSpan.spanContext();
    this.context = {
      spanId: spanContext.spanId,
      traceId: spanContext.traceId || traceId,
      isRemote: spanContext.isRemote,
    };
  }

  getOtelSpan(): any {
    return this.otelSpan;
  }

  setAttribute(key: string, value: any): void {
    this.otelSpan.setAttribute(key, value);
  }

  setAttributes(attributes: Record<string, any>): void {
    this.otelSpan.setAttributes(attributes);
  }

  addEvent(name: string, attributes?: Record<string, any>): void {
    this.otelSpan.addEvent(name, attributes);
  }

  recordException(error: Error, attributes?: Record<string, any>): void {
    this.otelSpan.recordException(error, attributes);
  }

  setStatus(status: 'ok' | 'error' | 'unset', message?: string): void {
    const statusMap: Record<string, any> = {
      ok: { code: this.otelApi.SpanStatusCode.OK },
      error: { code: this.otelApi.SpanStatusCode.ERROR, message },
      unset: { code: this.otelApi.SpanStatusCode.UNSET },
    };
    this.otelSpan.setStatus(statusMap[status]);
  }

  updateName(name: string): void {
    this.otelSpan.updateName(name);
  }

  end(endTime?: number): void {
    if (endTime) {
      this.otelSpan.end(endTime);
    } else {
      this.otelSpan.end();
    }
  }

  isEnded(): boolean {
    // OpenTelemetry spans don't expose this directly, so we track it
    return (this.otelSpan as any)._ended === true;
  }

  getStartTime(): number {
    return (this.otelSpan as any).startTime?.[0] * 1000 + (this.otelSpan as any).startTime?.[1] / 1000000 || Date.now();
  }

  getEndTime(): number | undefined {
    const endTime = (this.otelSpan as any).endTime;
    if (!endTime) {
      return undefined;
    }
    return endTime[0] * 1000 + endTime[1] / 1000000;
  }

  getDuration(): number | undefined {
    const endTime = this.getEndTime();
    if (!endTime) {
      return undefined;
    }
    return endTime - this.getStartTime();
  }
}
