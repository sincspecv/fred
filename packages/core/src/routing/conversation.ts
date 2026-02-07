/**
 * Conversation-aware confidence adjustment.
 *
 * Boosts or penalizes confidence based on prior routing decisions
 * within the same conversation context.
 */

export interface ConversationRoutingHistory {
  /** Previous routing decisions in conversation */
  previousDecisions: Array<{
    /** Target agent/intent ID that was selected */
    targetId: string;
    /** Confidence of that decision */
    confidence: number;
    /** Whether that decision was correct (if known) */
    wasCorrect?: boolean;
    /** Turn number when decision was made */
    turnNumber: number;
  }>;
  /** Current turn number in conversation */
  currentTurn: number;
}

/**
 * Calculate confidence boost/penalty from conversation history.
 *
 * Same-intent recurrence boost: +0.05 per occurrence (max +0.15)
 * - Looks at last 3 decisions
 * - Counts how many route to same targetId with confidence > 0.8
 *
 * Correction penalty: -0.10 penalty
 * - Applied if most recent decision has wasCorrect === false
 *
 * @param history - Conversation routing history
 * @param currentTargetId - Current routing target being considered
 * @returns Boost value clamped to [-0.15, +0.15]
 */
export function calculateConversationBoost(
  history: ConversationRoutingHistory,
  currentTargetId: string
): number {
  // No history? No boost
  if (!history.previousDecisions || history.previousDecisions.length === 0) {
    return 0;
  }

  let boost = 0;

  // Same-intent recurrence boost: Look at last 3 decisions
  const recentDecisions = history.previousDecisions.slice(-3);
  const highConfidenceMatches = recentDecisions.filter(
    (d) => d.targetId === currentTargetId && d.confidence > 0.8
  ).length;

  if (highConfidenceMatches > 0) {
    boost += highConfidenceMatches * 0.05; // Max +0.15
  }

  // Correction penalty: If most recent decision was incorrect
  const mostRecent = history.previousDecisions[history.previousDecisions.length - 1];
  if (mostRecent && mostRecent.wasCorrect === false) {
    boost -= 0.1;
  }

  // Clamp to [-0.15, +0.15]
  return Math.max(-0.15, Math.min(0.15, boost));
}

/**
 * Create empty conversation routing history.
 */
export function createConversationRoutingHistory(): ConversationRoutingHistory {
  return {
    previousDecisions: [],
    currentTurn: 0,
  };
}
