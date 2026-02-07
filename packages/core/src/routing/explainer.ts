/**
 * Routing explanation generator.
 *
 * Produces structured explanations and human-readable narratives
 * from routing decision data.
 */

import type {
  RoutingAlternative,
  RoutingExplanation,
  RoutingConcern,
  CalibrationMetadata,
  MatchType,
} from './types';

/** Low confidence threshold for concern detection */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Close alternatives gap threshold for concern detection */
const CLOSE_ALTERNATIVES_GAP = 0.1;

/**
 * Detect routing concerns from explanation data.
 *
 * @param winner - Selected routing alternative
 * @param alternatives - Runner-up alternatives
 * @returns Array of detected concerns
 */
export function detectConcerns(
  winner: RoutingAlternative,
  alternatives: RoutingAlternative[]
): RoutingConcern[] {
  const concerns: RoutingConcern[] = [];

  // Low confidence concern
  if (winner.confidence < LOW_CONFIDENCE_THRESHOLD) {
    concerns.push({
      type: 'low-confidence',
      severity: 'warning',
      message: `Winner confidence ${winner.confidence.toFixed(2)} is below threshold ${LOW_CONFIDENCE_THRESHOLD}`,
    });
  }

  // Close alternatives concern
  if (alternatives.length > 0) {
    const topAlternative = alternatives[0];
    const gap = winner.confidence - topAlternative.confidence;

    if (gap < CLOSE_ALTERNATIVES_GAP) {
      concerns.push({
        type: 'close-alternatives',
        severity: 'warning',
        message: `Winner confidence ${winner.confidence.toFixed(2)} is very close to alternative ${topAlternative.targetName} (${topAlternative.confidence.toFixed(2)})`,
      });
    }
  }

  return concerns;
}

/**
 * Build human-readable narrative from explanation data.
 *
 * @param winner - Selected routing alternative
 * @param alternatives - Runner-up alternatives
 * @param calibrationMetadata - Calibration debugging info
 * @param matchType - How the match was made
 * @returns Narrative explanation text
 */
export function buildNarrative(
  winner: RoutingAlternative,
  alternatives: RoutingAlternative[],
  calibrationMetadata: CalibrationMetadata,
  matchType: MatchType
): string {
  const parts: string[] = [];

  // Winner selection
  parts.push(
    `Selected ${winner.targetName} (${winner.targetId}) with ${(winner.confidence * 100).toFixed(1)}% confidence`
  );

  // Match type
  const matchTypeDescriptions: Record<MatchType, string> = {
    exact: 'exact pattern match',
    regex: 'regular expression match',
    keyword: 'keyword match',
    function: 'custom function match',
    'metadata-only': 'metadata-only match',
  };
  parts.push(`via ${matchTypeDescriptions[matchType]}`);

  // Calibration info
  if (calibrationMetadata.calibrated) {
    parts.push(
      `Calibrated from raw score ${(calibrationMetadata.rawScore * 100).toFixed(1)}%`
    );
    if (calibrationMetadata.temperature !== undefined) {
      parts.push(`using temperature ${calibrationMetadata.temperature.toFixed(2)}`);
    }
  } else {
    parts.push(`(uncalibrated - ${calibrationMetadata.observationCount ?? 0} observations, need 50+)`);
  }

  // Historical accuracy
  if (calibrationMetadata.historicalAccuracy !== undefined) {
    parts.push(
      `Historical accuracy: ${(calibrationMetadata.historicalAccuracy * 100).toFixed(1)}%`
    );
  }

  // Alternatives
  if (alternatives.length > 0) {
    const altList = alternatives
      .map(
        (alt) =>
          `${alt.targetName} (${(alt.confidence * 100).toFixed(1)}%)`
      )
      .join(', ');
    parts.push(`Alternatives: ${altList}`);
  }

  return parts.join('. ') + '.';
}

/**
 * Generate complete routing explanation.
 *
 * @param winner - Selected routing alternative
 * @param alternatives - All alternative candidates
 * @param calibrationMetadata - Calibration debugging info
 * @param matchType - How the match was made
 * @returns Complete routing explanation
 */
export function generateRoutingExplanation(
  winner: RoutingAlternative,
  alternatives: RoutingAlternative[],
  calibrationMetadata: CalibrationMetadata,
  matchType: MatchType
): RoutingExplanation {
  // Filter and sort alternatives
  const filteredAlternatives = alternatives
    .filter((alt) => alt.confidence > 0) // Remove zero-confidence items
    .filter((alt) => alt.targetId !== winner.targetId) // Remove winner
    .sort((a, b) => b.confidence - a.confidence) // Sort by confidence descending
    .slice(0, 3); // Top 3 only

  // Detect concerns
  const concerns = detectConcerns(winner, filteredAlternatives);

  // Build narrative
  const narrative = buildNarrative(
    winner,
    filteredAlternatives,
    calibrationMetadata,
    matchType
  );

  return {
    winner,
    alternatives: filteredAlternatives,
    confidence: winner.confidence,
    matchType,
    calibrationMetadata,
    concerns,
    narrative,
  };
}
