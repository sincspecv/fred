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
import { getCurrentCorrelationContext, getCurrentSpanIds } from './context';

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
  }
>() {}

/**
 * Hash a value using SHA-256.
 */
function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
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

    return {
      getContext: () => Effect.sync(() => getCurrentCorrelationContext()),

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
          const ctx = getCurrentCorrelationContext();

          // Get current span IDs (may have changed since context was created)
          const spanIds = getCurrentSpanIds();

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

          return totalCost;
        }),

      hashPayload: (payload) => Effect.sync(() => hashValue(payload)),

      startRun: (runId) =>
        Effect.sync(() => {
          runStore.set(runId, {
            runId,
            startTime: Date.now(),
            hookEvents: [],
            stepSpans: [],
            toolUsage: [],
            modelUsage: [],
            hasError: false,
            isSlow: false,
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
    };
  })
);
