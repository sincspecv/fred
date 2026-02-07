/**
 * Temperature scaling calibration for confidence scores.
 *
 * Uses logit transform and temperature parameter to calibrate probability estimates.
 * Adjusts based on Expected Calibration Error (ECE) when sufficient observations exist.
 */

import { Effect } from 'effect';
import type { Calibrator } from './index';

/** Minimum samples required before recalibration (cold-start behavior until this threshold) */
const MIN_SAMPLES = 100;

/** Number of bins for ECE calculation */
const ECE_BINS = 10;

/** Target ECE threshold for calibration adjustment */
const ECE_THRESHOLD = 0.1;

/** Maximum number of observations to keep (rolling window) */
const MAX_OBSERVATIONS = 200;

/** Temperature parameter bounds */
const MIN_TEMPERATURE = 0.1;
const MAX_TEMPERATURE = 10.0;

/** Score bounds for logit transform (avoid infinities) */
const MIN_SCORE = 0.001;
const MAX_SCORE = 0.999;

/**
 * Observation record for calibration.
 */
export interface CalibrationObservation {
  /** Predicted confidence score */
  predicted: number;
  /** Whether prediction was correct */
  actual: boolean;
}

/**
 * Temperature scaling calibrator.
 * Applies logit transform with temperature parameter to improve calibration.
 */
export interface TemperatureScalingCalibrator extends Calibrator {
  /**
   * Get current temperature parameter.
   */
  getTemperature(): Effect.Effect<number>;

  /**
   * Get current observation count.
   */
  getObservationCount(): Effect.Effect<number>;
}

/**
 * Calculate Expected Calibration Error (ECE).
 * Measures average gap between predicted confidence and actual accuracy.
 *
 * @param observations - Calibration observations
 * @param bins - Number of bins for bucketing predictions
 * @returns ECE value (0.0 = perfectly calibrated, higher = worse)
 */
export function calculateECE(
  observations: CalibrationObservation[],
  bins: number = ECE_BINS
): number {
  if (observations.length === 0) return 0;

  // Create bins
  const binSize = 1.0 / bins;
  const binCounts = new Array<number>(bins).fill(0);
  const binCorrect = new Array<number>(bins).fill(0);
  const binConfidence = new Array<number>(bins).fill(0);

  // Populate bins
  for (const obs of observations) {
    const binIndex = Math.min(Math.floor(obs.predicted / binSize), bins - 1);
    binCounts[binIndex]++;
    binConfidence[binIndex] += obs.predicted;
    if (obs.actual) {
      binCorrect[binIndex]++;
    }
  }

  // Calculate ECE
  let ece = 0;
  const total = observations.length;

  for (let i = 0; i < bins; i++) {
    if (binCounts[i] === 0) continue;

    const accuracy = binCorrect[i] / binCounts[i];
    const avgConfidence = binConfidence[i] / binCounts[i];
    const weight = binCounts[i] / total;

    ece += weight * Math.abs(avgConfidence - accuracy);
  }

  return ece;
}

/**
 * Logit transform (inverse of sigmoid).
 * Maps probability to unbounded real number.
 */
function logit(p: number): number {
  // Clamp to avoid infinities
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Sigmoid function.
 * Maps unbounded real number to probability.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Create a temperature scaling calibrator.
 * Starts with temperature=1.0 (no scaling) and adapts based on observations.
 */
export function createTemperatureScalingCalibrator(): Effect.Effect<TemperatureScalingCalibrator> {
  return Effect.sync(() => {
    let temperature = 1.0;
    let observations: CalibrationObservation[] = [];

    const calibrator: TemperatureScalingCalibrator = {
      calibrate: (rawScore: number) =>
        Effect.sync(() => {
          // Cold-start: no scaling until MIN_SAMPLES observations
          if (observations.length < MIN_SAMPLES) {
            return rawScore;
          }

          // Apply temperature scaling: logit -> scale -> sigmoid
          const logitScore = logit(rawScore);
          const scaledLogit = logitScore / temperature;
          const calibrated = sigmoid(scaledLogit);

          return calibrated;
        }),

      update: (predicted: number, actual: boolean) =>
        Effect.sync(() => {
          // Add new observation
          observations.push({ predicted, actual });

          // Keep rolling window
          if (observations.length > MAX_OBSERVATIONS) {
            observations = observations.slice(-MAX_OBSERVATIONS);
          }

          // Only recalibrate when we have enough samples
          if (observations.length < MIN_SAMPLES) {
            return;
          }

          // Calculate ECE
          const ece = calculateECE(observations);

          // Adjust temperature if ECE is too high
          if (ece > ECE_THRESHOLD) {
            const adjustment = 1 + ece * 0.1;
            temperature = Math.max(
              MIN_TEMPERATURE,
              Math.min(MAX_TEMPERATURE, temperature * adjustment)
            );
          }
        }),

      getTemperature: () => Effect.sync(() => temperature),

      getObservationCount: () => Effect.sync(() => observations.length),
    };

    return calibrator;
  });
}
