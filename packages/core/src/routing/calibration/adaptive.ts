/**
 * Adaptive calibration coordinator.
 *
 * Manages separate calibrators for rule-based and intent-based routing.
 * Each routing source type gets its own temperature scaling calibrator.
 */

import { Effect } from 'effect';
import type { Calibrator } from './index';
import {
  createTemperatureScalingCalibrator,
  type TemperatureScalingCalibrator,
} from './temperature';

/**
 * Routing source type for calibration.
 */
export type RoutingSource = 'rule' | 'intent';

/**
 * Calibration state for debugging.
 */
export interface CalibrationState {
  /** Rule-based routing temperature */
  ruleTemperature: number;
  /** Intent-based routing temperature */
  intentTemperature: number;
  /** Rule-based observation count */
  ruleObservations: number;
  /** Intent-based observation count */
  intentObservations: number;
}

/**
 * Adaptive calibration coordinator.
 * Routes calibration calls to appropriate source-specific calibrator.
 */
export interface AdaptiveCalibrationCoordinator {
  /**
   * Calibrate a score for specific routing source.
   * @param rawScore - Original uncalibrated score (0.0-1.0)
   * @param source - Routing source type
   * @returns Calibrated score (0.0-1.0)
   */
  calibrate(rawScore: number, source: RoutingSource): Effect.Effect<number>;

  /**
   * Update calibration model with new observation.
   * @param predicted - Predicted confidence score
   * @param actual - Whether the prediction was correct
   * @param source - Routing source type
   */
  update(predicted: number, actual: boolean, source: RoutingSource): Effect.Effect<void>;

  /**
   * Get current calibration state for debugging.
   */
  getState(): Effect.Effect<CalibrationState>;
}

/**
 * Create an adaptive calibration coordinator.
 * Initializes separate calibrators for rule and intent routing.
 */
export function createAdaptiveCalibrationCoordinator(): Effect.Effect<AdaptiveCalibrationCoordinator> {
  return Effect.flatMap(
    Effect.all([createTemperatureScalingCalibrator(), createTemperatureScalingCalibrator()]),
    ([ruleCalibrator, intentCalibrator]) => {
      const coordinator: AdaptiveCalibrationCoordinator = {
        calibrate: (rawScore: number, source: RoutingSource) => {
          const calibrator = source === 'rule' ? ruleCalibrator : intentCalibrator;
          return calibrator.calibrate(rawScore);
        },

        update: (predicted: number, actual: boolean, source: RoutingSource) => {
          const calibrator = source === 'rule' ? ruleCalibrator : intentCalibrator;
          return calibrator.update(predicted, actual);
        },

        getState: () =>
          Effect.flatMap(
            Effect.all([
              ruleCalibrator.getTemperature(),
              intentCalibrator.getTemperature(),
              ruleCalibrator.getObservationCount(),
              intentCalibrator.getObservationCount(),
            ]),
            ([ruleTemp, intentTemp, ruleObs, intentObs]) => Effect.succeed({
              ruleTemperature: ruleTemp,
              intentTemperature: intentTemp,
              ruleObservations: ruleObs,
              intentObservations: intentObs,
            })
          ),
      };

      return Effect.succeed(coordinator);
    }
  );
}
