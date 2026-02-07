/**
 * Tests for conversation-aware confidence adjustment
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateConversationBoost,
  createConversationRoutingHistory,
  type ConversationRoutingHistory,
} from '../../../../packages/core/src/routing/conversation';

describe('Conversation-aware Confidence Adjustment', () => {
  it('calculateConversationBoost returns 0 for empty history', () => {
    const history = createConversationRoutingHistory();
    const boost = calculateConversationBoost(history, 'agent-1');

    expect(boost).toBe(0);
  });

  it('calculateConversationBoost returns positive boost for same-intent recurrence', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 1 },
        { targetId: 'agent-1', confidence: 0.85, turnNumber: 2 },
      ],
      currentTurn: 3,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // 2 high-confidence matches → +0.10
    expect(boost).toBe(0.10);
  });

  it('calculateConversationBoost caps boost at +0.15', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 1 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 2 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 3 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 4 }, // 4th shouldn't count
      ],
      currentTurn: 5,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // Only last 3 count → 3 * 0.05 = 0.15 (capped)
    expect(boost).toBe(0.15);
  });

  it('calculateConversationBoost applies -0.10 penalty for recent incorrect decision', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.9, wasCorrect: false, turnNumber: 1 },
      ],
      currentTurn: 2,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // 1 high-confidence match → +0.05, then penalty -0.10 = -0.05
    expect(boost).toBe(-0.05);
  });

  it('calculateConversationBoost clamps to [-0.15, +0.15]', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 1 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 2 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 3 },
        { targetId: 'agent-1', confidence: 0.9, wasCorrect: false, turnNumber: 4 },
      ],
      currentTurn: 5,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // Last 3: [turn 2, turn 3, turn 4] → 3 * 0.05 = 0.15, minus 0.10 penalty = 0.05
    expect(boost).toBeCloseTo(0.05, 10); // Use toBeCloseTo for float precision
  });

  it('calculateConversationBoost ignores low-confidence decisions for recurrence boost', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.5, turnNumber: 1 }, // Too low
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 2 },
      ],
      currentTurn: 3,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // Only 1 high-confidence match → +0.05
    expect(boost).toBe(0.05);
  });

  it('calculateConversationBoost only counts last 3 decisions', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 1 }, // Too old
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 2 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 3 },
        { targetId: 'agent-1', confidence: 0.9, turnNumber: 4 },
      ],
      currentTurn: 5,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // Last 3 decisions → 3 * 0.05 = 0.15
    expect(boost).toBe(0.15);
  });

  it('calculateConversationBoost returns 0 for different targetId', () => {
    const history: ConversationRoutingHistory = {
      previousDecisions: [
        { targetId: 'agent-2', confidence: 0.9, turnNumber: 1 },
        { targetId: 'agent-2', confidence: 0.9, turnNumber: 2 },
      ],
      currentTurn: 3,
    };

    const boost = calculateConversationBoost(history, 'agent-1');

    // No matches for agent-1
    expect(boost).toBe(0);
  });

  it('createConversationRoutingHistory returns empty history', () => {
    const history = createConversationRoutingHistory();

    expect(history.previousDecisions).toEqual([]);
    expect(history.currentTurn).toBe(0);
  });
});
