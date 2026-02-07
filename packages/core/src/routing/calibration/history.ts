/**
 * Historical accuracy tracking for per-intent/per-rule calibration.
 *
 * Maintains separate accuracy records for each routing target.
 */

import { Effect } from 'effect';

/**
 * Accuracy record for a specific target.
 */
interface AccuracyRecord {
  /** Number of correct predictions */
  correct: number;
  /** Total number of predictions */
  total: number;
}

/**
 * Historical accuracy tracker.
 * Tracks per-target accuracy for confidence calibration.
 */
export interface HistoricalAccuracyTracker {
  /**
   * Record an outcome for a specific target.
   * @param targetId - Intent or agent identifier
   * @param wasCorrect - Whether the routing was correct
   */
  recordOutcome(targetId: string, wasCorrect: boolean): Effect.Effect<void>;

  /**
   * Get historical accuracy for a target.
   * @param targetId - Intent or agent identifier
   * @returns Accuracy (0.0-1.0) or undefined if no history
   */
  getAccuracy(targetId: string): Effect.Effect<number | undefined>;

  /**
   * Get observation count for a target.
   * @param targetId - Intent or agent identifier
   * @returns Number of observations
   */
  getObservationCount(targetId: string): Effect.Effect<number>;
}

/**
 * Create a historical accuracy tracker.
 * Uses plain Map for state management.
 */
export function createHistoricalAccuracyTracker(): Effect.Effect<HistoricalAccuracyTracker> {
  return Effect.sync(() => {
    const records = new Map<string, AccuracyRecord>();

    const tracker: HistoricalAccuracyTracker = {
      recordOutcome: (targetId: string, wasCorrect: boolean) =>
        Effect.sync(() => {
          const existing = records.get(targetId) || { correct: 0, total: 0 };

          const updated = {
            correct: existing.correct + (wasCorrect ? 1 : 0),
            total: existing.total + 1,
          };

          records.set(targetId, updated);
        }),

      getAccuracy: (targetId: string) =>
        Effect.sync(() => {
          const record = records.get(targetId);

          if (!record || record.total === 0) {
            return undefined;
          }

          return record.correct / record.total;
        }),

      getObservationCount: (targetId: string) =>
        Effect.sync(() => {
          const record = records.get(targetId);
          return record?.total ?? 0;
        }),
    };

    return tracker;
  });
}
