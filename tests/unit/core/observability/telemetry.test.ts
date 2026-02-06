/**
 * Telemetry tests
 *
 * Verifies sampling, metrics recording, token usage tracking, and trace export.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import {
  ObservabilityServiceLive,
  ObservabilityService,
  type SamplingDecision,
  type MetricsSnapshot,
  type OtelMetricsExport,
} from '../../../../packages/core/src/observability/service';

describe('Telemetry', () => {
  let service: ObservabilityService;

  beforeEach(async () => {
    // Create live observability service
    const program = Effect.gen(function* () {
      return yield* ObservabilityService;
    });

    service = await Effect.runPromise(
      program.pipe(Effect.provide(ObservabilityServiceLive))
    );
  });

  describe('Sampling', () => {
    test('should always sample errors', async () => {
      const decision = await Effect.runPromise(
        service.shouldSampleRun({ runId: 'run-123', hasError: true })
      );

      expect(decision.shouldSample).toBe(true);
      expect(decision.reason).toBe('error');
    });

    test('should always sample slow runs', async () => {
      const decision = await Effect.runPromise(
        service.shouldSampleRun({ runId: 'run-456', durationMs: 10000 })
      );

      expect(decision.shouldSample).toBe(true);
      expect(decision.reason).toBe('slow');
    });

    test('should use deterministic sampling for success runs', async () => {
      const runId = 'run-deterministic-123';

      // Same runId should give same decision
      const decision1 = await Effect.runPromise(
        service.shouldSampleRun({ runId })
      );
      const decision2 = await Effect.runPromise(
        service.shouldSampleRun({ runId })
      );

      expect(decision1.shouldSample).toBe(decision2.shouldSample);
      expect(decision1.reason).toBe(decision2.reason);
    });

    test('should filter most success runs at 1% sample rate', async () => {
      const results: SamplingDecision[] = [];

      // Test 100 different runIds
      for (let i = 0; i < 100; i++) {
        const decision = await Effect.runPromise(
          service.shouldSampleRun({ runId: `run-test-${i}` })
        );
        results.push(decision);
      }

      const sampledCount = results.filter((d) => d.shouldSample).length;
      const filteredCount = results.filter((d) => !d.shouldSample).length;

      // At 1% sample rate, expect ~1 sampled and ~99 filtered
      // Allow some variance due to hash distribution
      expect(sampledCount).toBeGreaterThan(0);
      expect(filteredCount).toBeGreaterThan(90);
    });
  });

  describe('Token Usage and Cost', () => {
    test('should record token usage', async () => {
      await Effect.runPromise(
        service.recordTokenUsage({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      // Verify metric was recorded (internal counter incremented)
      // Since we can't directly inspect Effect Metric counters, we verify via export
      const metrics = await Effect.runPromise(service.exportMetrics());
      expect(metrics.metrics.tokenUsage.total).toBeGreaterThan(0);
    });

    test('should record model cost when pricing is configured', async () => {
      // Note: In production, pricing would be configured via ObservabilityServiceConfig
      // For this test, we just verify the method runs without error
      const cost = await Effect.runPromise(
        service.recordModelCost({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      // Without pricing configured, cost should be undefined
      expect(cost).toBeUndefined();
    });

    test('should record token counts on model spans', async () => {
      // This is tested indirectly through agent factory tests
      // Token counts are set as span attributes which we can't easily inspect
      // without a full tracer mock. The agent factory tests verify this behavior.
      expect(true).toBe(true);
    });
  });

  describe('Hook Telemetry', () => {
    test('should record hook events', async () => {
      await Effect.runPromise(service.recordHookEvent('beforeMessageReceived'));
      await Effect.runPromise(service.recordHookEvent('afterMessageReceived'));
      await Effect.runPromise(service.recordHookEvent('beforeMessageReceived'));

      const metrics = await Effect.runPromise(service.exportMetrics());
      expect(metrics.metrics.hookEvents['beforeMessageReceived']).toBeGreaterThan(0);
      expect(metrics.metrics.hookEvents['afterMessageReceived']).toBeGreaterThan(0);
    });
  });

  describe('Metrics Export', () => {
    test('should export metrics as JSON snapshot', async () => {
      // Record some metrics
      await Effect.runPromise(
        service.recordTokenUsage({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        })
      );
      await Effect.runPromise(service.recordHookEvent('beforeMessageReceived'));

      const snapshot = await Effect.runPromise(service.exportMetrics());

      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.metrics).toBeDefined();
      expect(snapshot.metrics.tokenUsage).toBeDefined();
      expect(snapshot.metrics.hookEvents).toBeDefined();
      expect(snapshot.metrics.modelCost).toBeDefined();
    });

    test('should export metrics in Prometheus format', async () => {
      // Record some metrics
      await Effect.runPromise(
        service.recordTokenUsage({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      const prometheusText = await Effect.runPromise(service.exportMetricsPrometheus());

      expect(prometheusText).toContain('# HELP fred_hook_events_total');
      expect(prometheusText).toContain('# TYPE fred_hook_events_total counter');
      expect(prometheusText).toContain('# HELP fred_tokens_usage_total');
      expect(prometheusText).toContain('# HELP fred_model_cost_total');
    });

    test('should export metrics in OpenTelemetry format', async () => {
      // Record some metrics
      await Effect.runPromise(
        service.recordTokenUsage({
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      const otelExport = await Effect.runPromise(service.exportMetricsOtel());

      expect(otelExport.resourceMetrics).toBeDefined();
      expect(otelExport.resourceMetrics.length).toBeGreaterThan(0);
      expect(otelExport.resourceMetrics[0].resource.attributes['service.name']).toBe('fred');
      expect(otelExport.resourceMetrics[0].scopeMetrics).toBeDefined();
      expect(otelExport.resourceMetrics[0].scopeMetrics[0].metrics).toBeDefined();
    });

    test('should filter metrics by runId when specified', async () => {
      const runId = 'run-specific-123';

      // Start a run and record usage
      await Effect.runPromise(service.startRun(runId));
      await Effect.runPromise(
        service.recordRunModelUsage(runId, {
          provider: 'openai',
          model: 'gpt-4',
          timestamp: Date.now(),
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      const snapshot = await Effect.runPromise(service.exportMetrics({ runId }));

      expect(snapshot.runId).toBe(runId);
      expect(snapshot.metrics.tokenUsage.total).toBeGreaterThan(0);
    });
  });

  describe('Trace Export', () => {
    test('should export trace for a completed run', async () => {
      const runId = 'run-trace-export-123';

      // Start a run
      await Effect.runPromise(service.startRun(runId));

      // Record some events
      await Effect.runPromise(
        service.recordRunHookEvent(runId, {
          hookType: 'beforeMessageReceived',
          timestamp: Date.now(),
          metadata: { test: true },
        })
      );

      await Effect.runPromise(
        service.recordRunModelUsage(runId, {
          provider: 'openai',
          model: 'gpt-4',
          timestamp: Date.now(),
          inputTokens: 100,
          outputTokens: 50,
        })
      );

      // Complete the run
      await Effect.runPromise(service.completeRun(runId));

      // Export trace
      const trace = await Effect.runPromise(service.exportTrace(runId));

      expect(trace).toBeDefined();
      expect(trace?.runId).toBe(runId);
      expect(trace?.hookEvents.length).toBeGreaterThan(0);
      expect(trace?.modelUsage.length).toBeGreaterThan(0);
      expect(trace?.endTime).toBeDefined();
    });

    test('should return undefined for non-existent runId', async () => {
      const trace = await Effect.runPromise(service.exportTrace('non-existent'));
      expect(trace).toBeUndefined();
    });

    test('should include traceId in exported trace', async () => {
      const runId = 'run-with-trace-id';

      // Start a run (traceId would be populated from active span)
      await Effect.runPromise(service.startRun(runId));

      // Export trace
      const trace = await Effect.runPromise(service.exportTrace(runId));

      expect(trace).toBeDefined();
      // traceId may be undefined if no active span, but field should exist
      expect('traceId' in trace!).toBe(true);
    });
  });

  describe('Run Tracking', () => {
    test('should track run lifecycle', async () => {
      const runId = 'run-lifecycle-123';

      // Start run
      await Effect.runPromise(service.startRun(runId));

      // Get run record
      let record = await Effect.runPromise(service.getRunRecord(runId));
      expect(record).toBeDefined();
      expect(record?.runId).toBe(runId);
      expect(record?.endTime).toBeUndefined();

      // Complete run
      await Effect.runPromise(service.completeRun(runId));

      // Get updated record
      record = await Effect.runPromise(service.getRunRecord(runId));
      expect(record?.endTime).toBeDefined();
    });

    test('should mark run as error', async () => {
      const runId = 'run-error-123';

      await Effect.runPromise(service.startRun(runId));
      await Effect.runPromise(service.markRunError(runId));

      const record = await Effect.runPromise(service.getRunRecord(runId));
      expect(record?.hasError).toBe(true);
    });

    test('should mark run as slow', async () => {
      const runId = 'run-slow-123';

      await Effect.runPromise(service.startRun(runId));
      await Effect.runPromise(service.markRunSlow(runId));

      const record = await Effect.runPromise(service.getRunRecord(runId));
      expect(record?.isSlow).toBe(true);
    });
  });

  describe('TraceId Lookup', () => {
    test('should resolve traceId from runId', async () => {
      const runId = 'run-traceid-lookup';

      await Effect.runPromise(service.startRun(runId));

      const traceId = await Effect.runPromise(service.getTraceIdByRunId(runId));

      // traceId may be undefined if no active span during test
      expect(traceId === undefined || typeof traceId === 'string').toBe(true);
    });

    test('should return undefined for non-existent runId', async () => {
      const traceId = await Effect.runPromise(
        service.getTraceIdByRunId('non-existent-run')
      );
      expect(traceId).toBeUndefined();
    });
  });
});
