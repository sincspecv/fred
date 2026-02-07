import { describe, it, expect, beforeEach } from 'bun:test';
import { Effect } from 'effect';
import {
  createTemperatureScalingCalibrator,
  calculateECE,
  createHistoricalAccuracyTracker,
  createAdaptiveCalibrationCoordinator,
  type CalibrationObservation,
} from '../../../../packages/core/src/routing/calibration';

describe('TemperatureScalingCalibrator', () => {
  it('should start with temperature=1.0 (no scaling)', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());
    const temperature = await Effect.runPromise(calibrator.getTemperature());
    expect(temperature).toBe(1.0);
  });

  it('should return raw score during cold-start (<100 observations)', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());

    // Add 50 observations (below threshold)
    for (let i = 0; i < 50; i++) {
      await Effect.runPromise(calibrator.update(0.8, true));
    }

    // Should not apply scaling yet
    const calibrated = await Effect.runPromise(calibrator.calibrate(0.8));
    expect(calibrated).toBe(0.8);
  });

  it('should apply temperature scaling after MIN_SAMPLES observations', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());

    // Add overconfident predictions (high confidence, low accuracy)
    // This should increase temperature (spread out probabilities)
    for (let i = 0; i < 120; i++) {
      const correct = Math.random() < 0.5; // 50% actual accuracy
      await Effect.runPromise(calibrator.update(0.9, correct)); // But 90% predicted
    }

    const temperature = await Effect.runPromise(calibrator.getTemperature());
    const count = await Effect.runPromise(calibrator.getObservationCount());

    expect(count).toBe(120);
    // Temperature should be > 1.0 due to overconfidence
    expect(temperature).toBeGreaterThan(1.0);

    // Calibrated score should be lower than raw (less confident)
    const calibrated = await Effect.runPromise(calibrator.calibrate(0.9));
    expect(calibrated).toBeLessThan(0.9);
  });

  it('should maintain rolling window of observations', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());

    // Add more than MAX_OBSERVATIONS (200)
    for (let i = 0; i < 250; i++) {
      await Effect.runPromise(calibrator.update(0.7, true));
    }

    const count = await Effect.runPromise(calibrator.getObservationCount());
    expect(count).toBe(200); // Should cap at MAX_OBSERVATIONS
  });

  it('should clamp temperature to valid bounds', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());

    // Temperature should stay within [0.1, 10.0]
    const temperature = await Effect.runPromise(calibrator.getTemperature());
    expect(temperature).toBeGreaterThanOrEqual(0.1);
    expect(temperature).toBeLessThanOrEqual(10.0);
  });

  it('should handle edge case scores (near 0 and 1)', async () => {
    const calibrator = await Effect.runPromise(createTemperatureScalingCalibrator());

    // Should not throw on edge cases
    const nearZero = await Effect.runPromise(calibrator.calibrate(0.001));
    const nearOne = await Effect.runPromise(calibrator.calibrate(0.999));

    expect(nearZero).toBeGreaterThan(0);
    expect(nearZero).toBeLessThan(1);
    expect(nearOne).toBeGreaterThan(0);
    expect(nearOne).toBeLessThan(1);
  });
});

describe('calculateECE', () => {
  it('should return 0 for empty observations', () => {
    const ece = calculateECE([]);
    expect(ece).toBe(0);
  });

  it('should return 0 for perfectly calibrated predictions', () => {
    const observations: CalibrationObservation[] = [
      { predicted: 0.5, actual: true },
      { predicted: 0.5, actual: false },
      { predicted: 0.9, actual: true },
      { predicted: 0.9, actual: true },
      { predicted: 0.9, actual: true },
      { predicted: 0.1, actual: false },
      { predicted: 0.1, actual: false },
    ];

    const ece = calculateECE(observations);
    // Should be very small (near 0) for well-calibrated predictions
    expect(ece).toBeLessThan(0.2);
  });

  it('should return high ECE for overconfident predictions', () => {
    const observations: CalibrationObservation[] = Array.from({ length: 100 }, () => ({
      predicted: 0.9, // Always 90% confident
      actual: Math.random() < 0.5, // But only 50% accurate
    }));

    const ece = calculateECE(observations);
    // Should be high (poor calibration)
    expect(ece).toBeGreaterThan(0.2);
  });

  it('should handle custom bin count', () => {
    const observations: CalibrationObservation[] = [
      { predicted: 0.25, actual: true },
      { predicted: 0.75, actual: false },
    ];

    const ece5 = calculateECE(observations, 5);
    const ece10 = calculateECE(observations, 10);

    // Should both be valid
    expect(ece5).toBeGreaterThanOrEqual(0);
    expect(ece10).toBeGreaterThanOrEqual(0);
  });
});

describe('HistoricalAccuracyTracker', () => {
  it('should return undefined for unknown target', async () => {
    const tracker = await Effect.runPromise(createHistoricalAccuracyTracker());
    const accuracy = await Effect.runPromise(tracker.getAccuracy('unknown'));
    expect(accuracy).toBeUndefined();
  });

  it('should track accuracy for single target', async () => {
    const tracker = await Effect.runPromise(createHistoricalAccuracyTracker());

    // Record 3 correct, 1 incorrect
    await Effect.runPromise(tracker.recordOutcome('intent-a', true));
    await Effect.runPromise(tracker.recordOutcome('intent-a', true));
    await Effect.runPromise(tracker.recordOutcome('intent-a', true));
    await Effect.runPromise(tracker.recordOutcome('intent-a', false));

    const accuracy = await Effect.runPromise(tracker.getAccuracy('intent-a'));
    const count = await Effect.runPromise(tracker.getObservationCount('intent-a'));

    expect(accuracy).toBe(0.75); // 3/4
    expect(count).toBe(4);
  });

  it('should track accuracy for multiple targets independently', async () => {
    const tracker = await Effect.runPromise(createHistoricalAccuracyTracker());

    // Intent A: 100% accurate
    await Effect.runPromise(tracker.recordOutcome('intent-a', true));
    await Effect.runPromise(tracker.recordOutcome('intent-a', true));

    // Intent B: 0% accurate
    await Effect.runPromise(tracker.recordOutcome('intent-b', false));
    await Effect.runPromise(tracker.recordOutcome('intent-b', false));

    const accuracyA = await Effect.runPromise(tracker.getAccuracy('intent-a'));
    const accuracyB = await Effect.runPromise(tracker.getAccuracy('intent-b'));

    expect(accuracyA).toBe(1.0);
    expect(accuracyB).toBe(0.0);
  });

  it('should return 0 observation count for unknown target', async () => {
    const tracker = await Effect.runPromise(createHistoricalAccuracyTracker());
    const count = await Effect.runPromise(tracker.getObservationCount('unknown'));
    expect(count).toBe(0);
  });
});

describe('AdaptiveCalibrationCoordinator', () => {
  it('should maintain separate calibrators for rule and intent', async () => {
    const coordinator = await Effect.runPromise(createAdaptiveCalibrationCoordinator());

    // Update rule calibrator
    for (let i = 0; i < 150; i++) {
      await Effect.runPromise(coordinator.update(0.8, true, 'rule'));
    }

    // Update intent calibrator with different pattern
    for (let i = 0; i < 100; i++) {
      await Effect.runPromise(coordinator.update(0.9, false, 'intent'));
    }

    const state = await Effect.runPromise(coordinator.getState());

    expect(state.ruleObservations).toBe(150);
    expect(state.intentObservations).toBe(100);
    // Temperatures should be different due to different patterns
    expect(state.ruleTemperature).not.toBe(state.intentTemperature);
  });

  it('should delegate calibration to correct calibrator', async () => {
    const coordinator = await Effect.runPromise(createAdaptiveCalibrationCoordinator());

    // Both should work independently
    const ruleCalibrated = await Effect.runPromise(coordinator.calibrate(0.7, 'rule'));
    const intentCalibrated = await Effect.runPromise(
      coordinator.calibrate(0.7, 'intent')
    );

    // During cold-start, both should return raw score
    expect(ruleCalibrated).toBe(0.7);
    expect(intentCalibrated).toBe(0.7);
  });

  it('should start with default state', async () => {
    const coordinator = await Effect.runPromise(createAdaptiveCalibrationCoordinator());
    const state = await Effect.runPromise(coordinator.getState());

    expect(state.ruleTemperature).toBe(1.0);
    expect(state.intentTemperature).toBe(1.0);
    expect(state.ruleObservations).toBe(0);
    expect(state.intentObservations).toBe(0);
  });
});
