/**
 * Span status codes
 */
export enum SpanStatus {
  OK = 'ok',
  ERROR = 'error',
  UNSET = 'unset',
}

/**
 * Span kind
 */
export enum SpanKind {
  INTERNAL = 'internal',
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer',
}

/**
 * Span attributes (key-value pairs)
 */
export type SpanAttributes = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Span event
 */
export interface SpanEvent {
  name: string;
  time: number;
  attributes?: SpanAttributes;
}

/**
 * Span options for creating a new span
 */
export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  startTime?: number;
}

/**
 * Span context for propagation
 */
export interface SpanContext {
  spanId: string;
  traceId: string;
  isRemote?: boolean;
}
