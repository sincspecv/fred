/**
 * Calibration module for confidence score adjustment.
 *
 * Provides temperature scaling calibration to improve confidence score accuracy.
 */

import { Effect } from 'effect';

/**
 * Calibrator interface for adjusting confidence scores.
 * Implementations use observed outcomes to improve score accuracy.
 */
export interface Calibrator {
  /**
   * Calibrate a raw score to produce a more accurate confidence estimate.
   * @param rawScore - Original uncalibrated score (0.0-1.0)
   * @returns Calibrated score (0.0-1.0)
   */
  calibrate(rawScore: number): Effect.Effect<number>;

  /**
   * Update calibration model with new observation.
   * @param predicted - Predicted confidence score
   * @param actual - Whether the prediction was correct
   */
  update(predicted: number, actual: boolean): Effect.Effect<void>;
}

export * from './temperature';
export * from './adaptive';
export * from './history';
