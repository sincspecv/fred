/**
 * ObservabilityService for structured logging, metrics, and sampling.
 *
 * Provides centralized observability with deterministic sampling, JSON logging,
 * token/cost metrics, and run storage for hook events and trace export.
 *
 * @module src/core/observability/service
 */

import { Effect, Context, Layer, Metric, Logger, LogLevel } from 'effect';
import { createHash } from 'crypto';
import type { CorrelationContext } from './context';
import { getCurrentCorrelationContext, getCurrentSpanIds, getCorrelationContext, getSpanIds } from './context';

/**
 * Observability service configuration.
 */
export interface ObservabilityServiceConfig {
  /** Success sampling rate (0.0 to 1.0). Default: 0.01 (1%) */
  successSampleRate?: number;
  /** Slow threshold in milliseconds. Runs exceeding this are always sampled. Default: 5000 */
  slowThresholdMs?: number;
  /** Debug mode: force all runs to be sampled. Default: false */
  debugMode?: boolean;
  /** Service metadata attached to all logs and spans */
  serviceMetadata?: {
    serviceName?: string;
    serviceVersion?: string;
    environment?: string;
    [key: string]: unknown;
  };
  /** Pricing table for cost calculation (model -> price per token) */
  pricing?: Record<string, { input: number; output: number }>;
  /** Hash payloads by default (only include raw content when explicitly flagged) */
  hashPayloads?: boolean;
}

/**
 * Sampling decision result.
 */
export interface SamplingDecision {
  /** Whether to sample this run */
  shouldSample: boolean;
  /** Reason for the decision */
  reason: 'error' | 'slow' | 'debug' | 'sampled' | 'filtered';
}

/**
 * Run storage entry for hook events and trace export.
 */
export interface RunRecord {
  runId: string;
  traceId?: string;
  startTime: number;
  endTime?: number;
  /** Hook events recorded for this run */
  hookEvents: HookEvent[];
  /** Step spans recorded for this run */
  stepSpans: StepSpan[];
  /** Tool usage recorded for this run */
  toolUsage: ToolUsage[];
  /** Model usage recorded for this run */
  modelUsage: ModelUsage[];
  /** Whether this run had an error */
  hasError: boolean;
  /** Whether this run was slow */
  isSlow: boolean;
  /** Correlation context for this run */
  correlationContext?: CorrelationContext;
}

/**
 * Hook event record.
 */
export interface HookEvent {
  hookType: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

/**
 * Step span record.
 */
export interface StepSpan {
  stepName: string;
  startTime: number;
  endTime: number;
  status: 'success' | 'error';
  metadata: Record<string, unknown>;
}

/**
 * Tool usage record.
 */
export interface ToolUsage {
  toolId: string;
  timestamp: number;
  inputHash?: string;
  outputHash?: string;
  durationMs: number;
}

/**
 * Model usage record.
 */
export interface ModelUsage {
  provider: string;
  model: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  messageHash?: string;
}

/**
 * Metrics snapshot for JSON export.
 */
export interface MetricsSnapshot {
  timestamp: number;
  runId?: string;
  metrics: {
    hookEvents: Record<string, number>;
    tokenUsage: {
      total: number;
      byProvider: Record<string, { input: number; output: number; total: number }>;
    };
    modelCost: {
      total: number;
      byProvider: Record<string, number>;
    };
  };
}

/**
 * OpenTelemetry metrics export format.
 */
export interface OtelMetricsExport {
  resourceMetrics: Array<{
    resource: {
      attributes: Record<string, string>;
    };
    scopeMetrics: Array<{
      scope: {
        name: string;
        version: string;
      };
      metrics: Array<{
        name: string;
        description: string;
        unit?: string;
        sum?: {
          dataPoints: Array<{
            attributes: Record<string, string>;
            value: number;
            timeUnixNano: string;
          }>;
          isMonotonic: boolean;
        };
      }>;
    }>;
  }>;
}

/**
 * ObservabilityService tag.
 */
export class ObservabilityService extends Context.Tag('ObservabilityService')<
  ObservabilityService,
  {
    /** Get current correlation context */
    readonly getContext: () => Effect.Effect<CorrelationContext | undefined>;
    /** Determine if a run should be sampled */
    readonly shouldSampleRun: (options: {
      runId: string;
      hasError?: boolean;
      durationMs?: number;
    }) => Effect.Effect<SamplingDecision>;
    /** Log structured JSON with correlation context and service metadata */
    readonly logStructured: (options: {
      level: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';
      message: string;
      metadata?: Record<string, unknown>;
    }) => Effect.Effect<void>;
    /** Record a hook event metric */
    readonly recordHookEvent: (hookType: string) => Effect.Effect<void>;
    /** Record token usage metric */
    readonly recordTokenUsage: (options: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    }) => Effect.Effect<void>;
    /** Record model cost metric (if pricing configured) */
    readonly recordModelCost: (options: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    }) => Effect.Effect<number | undefined>;
    /** Hash a payload (for message/tool content) */
    readonly hashPayload: (payload: unknown) => Effect.Effect<string>;
    /** Start tracking a run */
    readonly startRun: (runId: string) => Effect.Effect<void>;
    /** Record a hook event for a run */
    readonly recordRunHookEvent: (runId: string, event: HookEvent) => Effect.Effect<void>;
    /** Record a step span for a run */
    readonly recordRunStepSpan: (runId: string, span: StepSpan) => Effect.Effect<void>;
    /** Record tool usage for a run */
    readonly recordRunToolUsage: (runId: string, usage: ToolUsage) => Effect.Effect<void>;
    /** Record model usage for a run */
    readonly recordRunModelUsage: (runId: string, usage: ModelUsage) => Effect.Effect<void>;
    /** Mark a run as having an error */
    readonly markRunError: (runId: string) => Effect.Effect<void>;
    /** Mark a run as slow */
    readonly markRunSlow: (runId: string) => Effect.Effect<void>;
    /** Complete a run */
    readonly completeRun: (runId: string) => Effect.Effect<void>;
    /** Get run record */
    readonly getRunRecord: (runId: string) => Effect.Effect<RunRecord | undefined>;
    /** Export run as trace */
    readonly exportTrace: (runId: string) => Effect.Effect<RunRecord | undefined>;
    /** Export metrics as JSON snapshot */
    readonly exportMetrics: (options?: { runId?: string; safe?: boolean }) => Effect.Effect<MetricsSnapshot>;
    /** Export metrics in Prometheus text format */
    readonly exportMetricsPrometheus: () => Effect.Effect<string>;
    /** Export metrics in OpenTelemetry format */
    readonly exportMetricsOtel: () => Effect.Effect<OtelMetricsExport>;
    /** Get traceId by runId */
    readonly getTraceIdByRunId: (runId: string) => Effect.Effect<string | undefined>;
  }
>() {}

/**
 * Hash a value using SHA-256.
 */
function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
}

function escapePrometheusLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

/**
 * Deterministic sampling based on runId.
 * Uses hash of runId to determine if run should be sampled.
 */
function isDeterministicallySampled(runId: string, sampleRate: number): boolean {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;

  // Hash runId to get deterministic value
  const hash = hashValue(runId);
  const hashInt = parseInt(hash.substring(0, 8), 16);
  const threshold = Math.floor(0xffffffff * sampleRate);

  return hashInt <= threshold;
}

/**
 * Create ObservabilityService live implementation.
 */
export const ObservabilityServiceLive = Layer.effect(
  ObservabilityService,
  Effect.gen(function* () {
    // Get config from environment or use defaults
    const config: ObservabilityServiceConfig = {
      successSampleRate: Number(process.env.FRED_SAMPLE_RATE) || 0.01,
      slowThresholdMs: Number(process.env.FRED_SLOW_THRESHOLD_MS) || 5000,
      debugMode: process.env.FRED_DEBUG === 'true',
      hashPayloads: process.env.FRED_HASH_PAYLOADS !== 'false',
      serviceMetadata: {
        serviceName: process.env.FRED_SERVICE_NAME || 'fred',
        serviceVersion: process.env.FRED_SERVICE_VERSION || '0.3.0',
        environment: process.env.NODE_ENV || 'development',
      },
      pricing: {}, // Pricing will be configured via config file
    };

    // Metrics
    const hookEventCounter = Metric.counter('fred.hook.events', {
      description: 'Hook events by type',
    });
    const tokenUsageCounter = Metric.counter('fred.tokens.usage', {
      description: 'Token usage by provider and model',
    });
    const modelCostCounter = Metric.counter('fred.model.cost', {
      description: 'Model cost by provider and model',
    });

    // In-memory run store
    const runStore = new Map<string, RunRecord>();

    // Global metrics aggregation for export
    const globalMetrics = {
      hookEvents: new Map<string, number>(),
      tokenUsage: new Map<string, { input: number; output: number }>(),
      modelCost: new Map<string, number>(),
    };

    return {
      getContext: () => getCorrelationContext,

      shouldSampleRun: (options) =>
        Effect.sync(() => {
          // Errors always sampled
          if (options.hasError) {
            return { shouldSample: true, reason: 'error' as const };
          }

          // Slow runs always sampled
          if (options.durationMs && options.durationMs > (config.slowThresholdMs ?? 5000)) {
            return { shouldSample: true, reason: 'slow' as const };
          }

          // Debug mode always samples
          if (config.debugMode) {
            return { shouldSample: true, reason: 'debug' as const };
          }

          // Deterministic sampling
          const sampled = isDeterministicallySampled(
            options.runId,
            config.successSampleRate ?? 0.01
          );

          return {
            shouldSample: sampled,
            reason: sampled ? ('sampled' as const) : ('filtered' as const),
          };
        }),

      logStructured: (options) =>
        Effect.gen(function* () {
          // Get correlation context
          const ctx = yield* getCorrelationContext;

          // Get current span IDs (may have changed since context was created)
          const spanIds = yield* getSpanIds;

          // Merge correlation context, span IDs, and service metadata
          const logData = {
            ...config.serviceMetadata,
            ...ctx,
            ...spanIds,
            ...options.metadata,
          };

          // Log at appropriate level with annotations
          const logEffect = (() => {
            switch (options.level) {
              case 'trace':
                return Effect.logTrace(options.message);
              case 'debug':
                return Effect.logDebug(options.message);
              case 'info':
                return Effect.logInfo(options.message);
              case 'warning':
                return Effect.logWarning(options.message);
              case 'error':
                return Effect.logError(options.message);
              case 'fatal':
                return Effect.logFatal(options.message);
              default:
                return Effect.logInfo(options.message);
            }
          })();

          yield* logEffect.pipe(Effect.annotateLogs(logData));
        }),

      recordHookEvent: (hookType) =>
        Effect.gen(function* () {
          yield* hookEventCounter.pipe(
            Metric.increment,
            Effect.annotateLogs({ hookType })
          );
          // Also track in global metrics for export
          globalMetrics.hookEvents.set(
            hookType,
            (globalMetrics.hookEvents.get(hookType) ?? 0) + 1
          );
        }),

      recordTokenUsage: (options) =>
        Effect.gen(function* () {
          const totalTokens = options.inputTokens + options.outputTokens;
          yield* tokenUsageCounter.pipe(
            Metric.incrementBy(totalTokens),
            Effect.annotateLogs({
              provider: options.provider,
              model: options.model,
              inputTokens: options.inputTokens,
              outputTokens: options.outputTokens,
            })
          );
          // Also track in global metrics for export
          const key = `${options.provider}:${options.model}`;
          const existing = globalMetrics.tokenUsage.get(key) ?? { input: 0, output: 0 };
          globalMetrics.tokenUsage.set(key, {
            input: existing.input + options.inputTokens,
            output: existing.output + options.outputTokens,
          });
        }),

      recordModelCost: (options) =>
        Effect.gen(function* () {
          const modelKey = `${options.provider}:${options.model}`;
          const pricing = config.pricing?.[modelKey];

          if (!pricing) {
            return undefined;
          }

          const inputCost = (options.inputTokens / 1000) * pricing.input;
          const outputCost = (options.outputTokens / 1000) * pricing.output;
          const totalCost = inputCost + outputCost;

          yield* modelCostCounter.pipe(
            Metric.incrementBy(totalCost),
            Effect.annotateLogs({
              provider: options.provider,
              model: options.model,
              cost: totalCost,
            })
          );

          // Also track in global metrics for export
          globalMetrics.modelCost.set(
            modelKey,
            (globalMetrics.modelCost.get(modelKey) ?? 0) + totalCost
          );

          return totalCost;
        }),

      hashPayload: (payload) => Effect.sync(() => hashValue(payload)),

      startRun: (runId) =>
        Effect.gen(function* () {
          const ctx = yield* getCorrelationContext;
          const spanIds = yield* getSpanIds;
          runStore.set(runId, {
            runId,
            traceId: spanIds.traceId,
            startTime: Date.now(),
            hookEvents: [],
            stepSpans: [],
            toolUsage: [],
            modelUsage: [],
            hasError: false,
            isSlow: false,
            correlationContext: ctx,
          });
        }),

      recordRunHookEvent: (runId, event) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.hookEvents.push(event);
          }
        }),

      recordRunStepSpan: (runId, span) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.stepSpans.push(span);
          }
        }),

      recordRunToolUsage: (runId, usage) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.toolUsage.push(usage);
          }
        }),

      recordRunModelUsage: (runId, usage) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.modelUsage.push(usage);
          }
        }),

      markRunError: (runId) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.hasError = true;
          }
        }),

      markRunSlow: (runId) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.isSlow = true;
          }
        }),

      completeRun: (runId) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            record.endTime = Date.now();
          }
        }),

      getRunRecord: (runId) => Effect.sync(() => runStore.get(runId)),

      exportTrace: (runId) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          if (record) {
            // Return a copy to prevent external modification
            return { ...record };
          }
          return undefined;
        }),

      exportMetrics: (options = {}) =>
        Effect.sync(() => {
          const timestamp = Date.now();
          let hookEvents: Record<string, number> = {};
          let tokenUsageByProvider: Record<string, { input: number; output: number; total: number }> = {};
          let costByProvider: Record<string, number> = {};

          if (options.runId) {
            // Filter by specific runId
            const record = runStore.get(options.runId);
            if (record) {
              // Aggregate hook events
              for (const event of record.hookEvents) {
                hookEvents[event.hookType] = (hookEvents[event.hookType] ?? 0) + 1;
              }

              // Aggregate token usage
              for (const usage of record.modelUsage) {
                const providerKey = `${usage.provider}:${usage.model}`;
                if (!tokenUsageByProvider[providerKey]) {
                  tokenUsageByProvider[providerKey] = { input: 0, output: 0, total: 0 };
                }
                tokenUsageByProvider[providerKey].input += usage.inputTokens;
                tokenUsageByProvider[providerKey].output += usage.outputTokens;
                tokenUsageByProvider[providerKey].total += usage.inputTokens + usage.outputTokens;

                if (usage.cost !== undefined) {
                  costByProvider[providerKey] = (costByProvider[providerKey] ?? 0) + usage.cost;
                }
              }
            }
          } else {
            // Use global metrics
            hookEvents = Object.fromEntries(globalMetrics.hookEvents.entries());

            for (const [key, usage] of globalMetrics.tokenUsage.entries()) {
              tokenUsageByProvider[key] = {
                input: usage.input,
                output: usage.output,
                total: usage.input + usage.output,
              };
            }

            costByProvider = Object.fromEntries(globalMetrics.modelCost.entries());
          }

          // Calculate totals
          const totalTokens = Object.values(tokenUsageByProvider).reduce(
            (sum, usage) => sum + usage.total,
            0
          );
          const totalCost = Object.values(costByProvider).reduce((sum, cost) => sum + cost, 0);

          return {
            timestamp,
            runId: options.runId,
            metrics: {
              hookEvents,
              tokenUsage: {
                total: totalTokens,
                byProvider: tokenUsageByProvider,
              },
              modelCost: {
                total: totalCost,
                byProvider: costByProvider,
              },
            },
          };
        }),

      exportMetricsPrometheus: () =>
        Effect.sync(() => {
          const lines: string[] = [];

          // Hook events counter
          lines.push('# HELP fred_hook_events_total Total hook events by type');
          lines.push('# TYPE fred_hook_events_total counter');
          for (const [hookType, count] of globalMetrics.hookEvents.entries()) {
            lines.push(
              `fred_hook_events_total{hook_type="${escapePrometheusLabelValue(hookType)}"} ${count}`
            );
          }

          // Token usage counter
          lines.push('# HELP fred_tokens_usage_total Total token usage by provider and model');
          lines.push('# TYPE fred_tokens_usage_total counter');
          for (const [key, usage] of globalMetrics.tokenUsage.entries()) {
            const [provider, model] = key.split(':');
            const escapedProvider = escapePrometheusLabelValue(provider ?? '');
            const escapedModel = escapePrometheusLabelValue(model ?? '');
            lines.push(
              `fred_tokens_usage_total{provider="${escapedProvider}",model="${escapedModel}",type="input"} ${usage.input}`
            );
            lines.push(
              `fred_tokens_usage_total{provider="${escapedProvider}",model="${escapedModel}",type="output"} ${usage.output}`
            );
          }

          // Model cost counter
          lines.push('# HELP fred_model_cost_total Total model cost by provider and model');
          lines.push('# TYPE fred_model_cost_total counter');
          for (const [key, cost] of globalMetrics.modelCost.entries()) {
            const [provider, model] = key.split(':');
            lines.push(
              `fred_model_cost_total{provider="${escapePrometheusLabelValue(provider ?? '')}",model="${escapePrometheusLabelValue(model ?? '')}"} ${cost}`
            );
          }

          return lines.join('\n') + '\n';
        }),

      exportMetricsOtel: () =>
        Effect.sync(() => {
          const timestamp = Date.now();
          const timeUnixNano = `${timestamp}000000`; // Convert to nanoseconds

          const metrics: OtelMetricsExport['resourceMetrics'][0]['scopeMetrics'][0]['metrics'] = [];

          // Hook events metric
          const hookEventDataPoints = Array.from(globalMetrics.hookEvents.entries()).map(
            ([hookType, count]) => ({
              attributes: { hook_type: hookType },
              value: count,
              timeUnixNano,
            })
          );
          if (hookEventDataPoints.length > 0) {
            metrics.push({
              name: 'fred.hook.events',
              description: 'Hook events by type',
              sum: {
                dataPoints: hookEventDataPoints,
                isMonotonic: true,
              },
            });
          }

          // Token usage metrics
          const tokenDataPoints: Array<{
            attributes: Record<string, string>;
            value: number;
            timeUnixNano: string;
          }> = [];
          for (const [key, usage] of globalMetrics.tokenUsage.entries()) {
            const [provider, model] = key.split(':');
            tokenDataPoints.push({
              attributes: { provider, model, type: 'input' },
              value: usage.input,
              timeUnixNano,
            });
            tokenDataPoints.push({
              attributes: { provider, model, type: 'output' },
              value: usage.output,
              timeUnixNano,
            });
          }
          if (tokenDataPoints.length > 0) {
            metrics.push({
              name: 'fred.tokens.usage',
              description: 'Token usage by provider and model',
              unit: 'tokens',
              sum: {
                dataPoints: tokenDataPoints,
                isMonotonic: true,
              },
            });
          }

          // Model cost metrics
          const costDataPoints = Array.from(globalMetrics.modelCost.entries()).map(([key, cost]) => {
            const [provider, model] = key.split(':');
            return {
              attributes: { provider, model },
              value: cost,
              timeUnixNano,
            };
          });
          if (costDataPoints.length > 0) {
            metrics.push({
              name: 'fred.model.cost',
              description: 'Model cost by provider and model',
              unit: 'USD',
              sum: {
                dataPoints: costDataPoints,
                isMonotonic: true,
              },
            });
          }

          return {
            resourceMetrics: [
              {
                resource: {
                  attributes: {
                    'service.name': config.serviceMetadata?.serviceName ?? 'fred',
                    'service.version': config.serviceMetadata?.serviceVersion ?? '0.3.0',
                  },
                },
                scopeMetrics: [
                  {
                    scope: {
                      name: 'fred-observability',
                      version: '1.0.0',
                    },
                    metrics,
                  },
                ],
              },
            ],
          };
        }),

      getTraceIdByRunId: (runId) =>
        Effect.sync(() => {
          const record = runStore.get(runId);
          return record?.traceId;
        }),
    };
  })
);
