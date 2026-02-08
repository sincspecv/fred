import type { Tracer, Span } from '../tracing';
import { NoOpTracer } from '../tracing/noop-tracer';
import {
  GOLDEN_TRACE_VERSION,
  generateGoldenTraceFilename,
} from './golden-trace';
import type {
  GoldenTrace,
  GoldenTraceSpan,
  GoldenTraceToolCall,
  GoldenTraceHandoff,
} from './golden-trace';
import type { AgentResponse } from '../agent/agent';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import packageJson from '../../package.json';
import { Effect } from 'effect';
import { EvaluationService, type EvaluationRecordOptions } from './service';
import type { EvaluationArtifact } from './artifact';

/**
 * Recorder for capturing traces into golden trace format
 */
export class GoldenTraceRecorder {
  private tracer: Tracer;
  private spans: Map<string, SpanData> = new Map();
  private toolCalls: GoldenTraceToolCall[] = [];
  private handoffs: GoldenTraceHandoff[] = [];
  private routing: {
    method: 'agent.utterance' | 'intent.matching' | 'default.agent';
    agentId?: string;
    intentId?: string;
    confidence?: number;
    matchType?: 'exact' | 'regex' | 'semantic';
  } = {
    method: 'default.agent',
  };
  private message: string = '';
  private response?: AgentResponse;
  private startTime: number = Date.now();

  constructor(tracer: Tracer) {
    this.tracer = tracer;
    this.startTime = Date.now();
  }

  /**
   * Set up automatic span capture using a callback-enabled tracer
   * This should be called if you want spans to be automatically captured
   * Returns a new tracer with the callback registered
   */
  createTracerWithCallback(): Tracer {
    if (this.tracer instanceof NoOpTracer) {
      // Create a new tracer with callback to capture spans
      return new NoOpTracer((span) => {
        this.addSpan(span);
      });
    }
    // For other tracers, return the original
    return this.tracer;
  }

  /**
   * Record a message being processed
   */
  recordMessage(message: string): void {
    this.message = message;
  }

  /**
   * Record routing information
   */
  recordRouting(routing: {
    method: 'agent.utterance' | 'intent.matching' | 'default.agent';
    agentId?: string;
    intentId?: string;
    confidence?: number;
    matchType?: 'exact' | 'regex' | 'semantic';
  }): void {
    this.routing = routing;
  }

  /**
   * Record a tool call
   */
  recordToolCall(toolCall: {
    toolId: string;
    args: Record<string, any>;
    result?: any;
    startTime: number;
    endTime: number;
    status: 'success' | 'error';
    error?: string;
  }): void {
    this.toolCalls.push({
      toolId: toolCall.toolId,
      args: toolCall.args,
      result: toolCall.result,
      timing: {
        startTime: toolCall.startTime,
        endTime: toolCall.endTime,
        duration: toolCall.endTime - toolCall.startTime,
      },
      status: toolCall.status,
      error: toolCall.error,
    });
  }

  /**
   * Record a handoff
   */
  recordHandoff(handoff: {
    fromAgent?: string;
    toAgent: string;
    message: string;
    context?: Record<string, any>;
    startTime: number;
    endTime: number;
    depth: number;
  }): void {
    this.handoffs.push({
      fromAgent: handoff.fromAgent,
      toAgent: handoff.toAgent,
      message: handoff.message,
      context: handoff.context,
      timing: {
        startTime: handoff.startTime,
        endTime: handoff.endTime,
        duration: handoff.endTime - handoff.startTime,
      },
      depth: handoff.depth,
    });
  }

  /**
   * Record the final response
   */
  recordResponse(response: AgentResponse): void {
    this.response = response;
  }

  /**
   * Capture all spans from the tracer
   * This should be called after processing is complete
   */
  captureSpans(): void {
    // For now, we'll need to track spans as they're created
    // The tracer doesn't expose all spans directly, so we'll need
    // to collect them during execution
    // This is a simplified implementation - in practice, you'd want
    // to hook into the tracer's span creation
  }

  /**
   * Add a span to be recorded
   * Called automatically when spans are created/ended if using NoOpTracer with callback
   */
  addSpan(span: Span): void {
    const spanId = span.context.spanId;
    const existing = this.spans.get(spanId);
    
    if (existing) {
      // Update existing span (e.g., when it ends)
      existing.endTime = span.getEndTime();
      existing.span = span;
    } else {
      // Add new span
      this.spans.set(spanId, {
        span,
        startTime: span.getStartTime(),
        endTime: span.getEndTime(),
      });
    }
  }

  /**
   * Convert recorded data to golden trace format
   */
  toGoldenTrace(): GoldenTrace {
    // Collect all spans
    const spans: GoldenTraceSpan[] = [];
    for (const spanData of this.spans.values()) {
      const span = spanData.span;
      const endTime = spanData.endTime || span.getEndTime() || Date.now();
      const startTime = spanData.startTime || span.getStartTime();
      const duration = endTime - startTime;

      // Get attributes (if available from NoOpSpan)
      let attributes: Record<string, any> = {};
      if ('getAttributes' in span) {
        attributes = (span as any).getAttributes();
      }

      // Get events (if available from NoOpSpan)
      let events: Array<{ name: string; time: number; attributes?: Record<string, any> }> = [];
      if ('getEvents' in span) {
        events = (span as any).getEvents();
      }

      // Get status (if available from NoOpSpan)
      let status: { code: 'ok' | 'error' | 'unset'; message?: string } = {
        code: 'ok',
        message: undefined,
      };
      if ('getStatus' in span) {
        const spanStatus = (span as any).getStatus();
        // Convert SpanStatus enum to string if needed
        const statusCode = typeof spanStatus.code === 'string' 
          ? spanStatus.code 
          : (spanStatus.code === 'ok' || spanStatus.code === 0 ? 'ok' 
             : spanStatus.code === 'error' || spanStatus.code === 1 ? 'error' 
             : 'unset');
        status = {
          code: statusCode as 'ok' | 'error' | 'unset',
          message: spanStatus.message,
        };
      }

      // Get kind (if available from NoOpSpan)
      let kind: string | undefined;
      if ('getKind' in span) {
        kind = (span as any).getKind();
      }

      spans.push({
        name: span.name,
        startTime,
        endTime,
        duration,
        attributes,
        events,
        status,
        kind,
      });
    }

    return {
      version: GOLDEN_TRACE_VERSION,
      metadata: {
        timestamp: this.startTime,
        fredVersion: packageJson.version,
        config: {},
        environment: {
          nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
          platform: typeof process !== 'undefined' ? process.platform : undefined,
        },
      },
      trace: {
        message: this.message,
        spans,
        response: this.response || { content: '' },
        toolCalls: this.toolCalls,
        handoffs: this.handoffs,
        routing: this.routing,
      },
    };
  }

  /**
   * Save golden trace to file
   */
  async saveToFile(outputPath: string): Promise<string> {
    const trace = this.toGoldenTrace();
    const json = JSON.stringify(trace, null, 2);
    
    // Generate hash for filename
    const hash = createHash('sha256').update(json).digest('hex').substring(0, 8);
    const filename = generateGoldenTraceFilename(GOLDEN_TRACE_VERSION, hash);
    const filepath = join(outputPath, filename);

    // Ensure directory exists
    await mkdir(dirname(filepath), { recursive: true });

    // Write file
    await writeFile(filepath, json, 'utf-8');

    return filepath;
  }

  /**
   * Reset the recorder for a new trace
   */
  reset(): void {
    this.spans.clear();
    this.toolCalls = [];
    this.handoffs = [];
    this.routing = {
      method: 'default.agent',
    };
    this.message = '';
    this.response = undefined;
    this.startTime = Date.now();
  }
}

/**
 * Internal span data structure
 */
interface SpanData {
  span: Span;
  startTime: number;
  endTime?: number;
}

/**
 * Effect-native recording entrypoint for deterministic evaluation artifacts.
 */
export const recordEvaluationArtifact = (
  runId: string,
  options?: EvaluationRecordOptions
): Effect.Effect<EvaluationArtifact, unknown, EvaluationService> =>
  Effect.gen(function* () {
    const service = yield* EvaluationService;
    return yield* service.record(runId, options);
  });

/**
 * Effect-native load entrypoint for deterministic evaluation artifacts.
 */
export const loadEvaluationArtifact = (
  traceId: string
): Effect.Effect<EvaluationArtifact, unknown, EvaluationService> =>
  Effect.gen(function* () {
    const service = yield* EvaluationService;
    return yield* service.load(traceId);
  });
