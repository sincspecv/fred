import { describe, it, expect } from 'bun:test';
import {
  generateRoutingExplanation,
  buildNarrative,
  detectConcerns,
} from '../../../../packages/core/src/routing/explainer';
import type {
  RoutingAlternative,
  CalibrationMetadata,
  MatchType,
} from '../../../../packages/core/src/routing/types';

describe('detectConcerns', () => {
  it('should detect low confidence concern', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.5, // Below 0.6 threshold
    };

    const concerns = detectConcerns(winner, []);

    expect(concerns).toHaveLength(1);
    expect(concerns[0].type).toBe('low-confidence');
    expect(concerns[0].severity).toBe('warning');
    expect(concerns[0].message).toContain('0.50');
  });

  it('should detect close alternatives concern', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.85,
    };

    const alternatives: RoutingAlternative[] = [
      {
        targetId: 'agent-b',
        targetName: 'Agent B',
        confidence: 0.82, // Gap of 0.03 (< 0.1 threshold)
      },
    ];

    const concerns = detectConcerns(winner, alternatives);

    expect(concerns).toHaveLength(1);
    expect(concerns[0].type).toBe('close-alternatives');
    expect(concerns[0].severity).toBe('warning');
    expect(concerns[0].message).toContain('Agent B');
  });

  it('should detect multiple concerns', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.55, // Low confidence
    };

    const alternatives: RoutingAlternative[] = [
      {
        targetId: 'agent-b',
        targetName: 'Agent B',
        confidence: 0.52, // Close alternative
      },
    ];

    const concerns = detectConcerns(winner, alternatives);

    expect(concerns).toHaveLength(2);
    expect(concerns.some((c) => c.type === 'low-confidence')).toBe(true);
    expect(concerns.some((c) => c.type === 'close-alternatives')).toBe(true);
  });

  it('should return empty array when no concerns', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.95, // High confidence
    };

    const alternatives: RoutingAlternative[] = [
      {
        targetId: 'agent-b',
        targetName: 'Agent B',
        confidence: 0.3, // Large gap
      },
    ];

    const concerns = detectConcerns(winner, alternatives);
    expect(concerns).toHaveLength(0);
  });
});

describe('buildNarrative', () => {
  it('should build basic narrative with winner', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.85,
    };

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.8,
      calibratedScore: 0.85,
      calibrated: true,
      temperature: 1.2,
      observationCount: 150,
    };

    const narrative = buildNarrative(winner, [], calibrationMetadata, 'regex');

    expect(narrative).toContain('Agent A');
    expect(narrative).toContain('85.0%');
    expect(narrative).toContain('regular expression match');
    expect(narrative).toContain('Calibrated from raw score 80.0%');
    expect(narrative).toContain('temperature 1.20');
  });

  it('should include alternatives in narrative', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.85,
    };

    const alternatives: RoutingAlternative[] = [
      { targetId: 'agent-b', targetName: 'Agent B', confidence: 0.7 },
      { targetId: 'agent-c', targetName: 'Agent C', confidence: 0.6 },
    ];

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.85,
      calibratedScore: 0.85,
      calibrated: false,
      observationCount: 10,
    };

    const narrative = buildNarrative(winner, alternatives, calibrationMetadata, 'keyword');

    expect(narrative).toContain('Alternatives:');
    expect(narrative).toContain('Agent B (70.0%)');
    expect(narrative).toContain('Agent C (60.0%)');
  });

  it('should include historical accuracy when available', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.9,
    };

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.85,
      calibratedScore: 0.9,
      calibrated: true,
      historicalAccuracy: 0.95,
      observationCount: 200,
    };

    const narrative = buildNarrative(winner, [], calibrationMetadata, 'exact');

    expect(narrative).toContain('Historical accuracy: 95.0%');
  });

  it('should indicate uncalibrated status', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.8,
    };

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.8,
      calibratedScore: 0.8,
      calibrated: false,
      observationCount: 25,
    };

    const narrative = buildNarrative(winner, [], calibrationMetadata, 'function');

    expect(narrative).toContain('uncalibrated');
    expect(narrative).toContain('25 observations, need 50+');
  });

  it('should describe all match types correctly', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.8,
    };

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.8,
      calibratedScore: 0.8,
      calibrated: false,
      observationCount: 0,
    };

    const matchTypes: MatchType[] = ['exact', 'regex', 'keyword', 'function', 'metadata-only'];

    for (const matchType of matchTypes) {
      const narrative = buildNarrative(winner, [], calibrationMetadata, matchType);
      expect(narrative.length).toBeGreaterThan(0);
    }
  });
});

describe('generateRoutingExplanation', () => {
  it('should generate complete explanation', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.85,
    };

    const alternatives: RoutingAlternative[] = [
      { targetId: 'agent-b', targetName: 'Agent B', confidence: 0.7 },
      { targetId: 'agent-c', targetName: 'Agent C', confidence: 0.6 },
      { targetId: 'agent-d', targetName: 'Agent D', confidence: 0.5 },
      { targetId: 'agent-e', targetName: 'Agent E', confidence: 0.4 },
    ];

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.8,
      calibratedScore: 0.85,
      calibrated: true,
      temperature: 1.1,
      observationCount: 120,
    };

    const explanation = generateRoutingExplanation(
      winner,
      alternatives,
      calibrationMetadata,
      'regex'
    );

    expect(explanation.winner).toEqual(winner);
    expect(explanation.confidence).toBe(0.85);
    expect(explanation.matchType).toBe('regex');
    expect(explanation.calibrationMetadata).toEqual(calibrationMetadata);
    expect(explanation.narrative.length).toBeGreaterThan(0);
    expect(explanation.concerns).toBeDefined();
    expect(explanation.alternatives).toHaveLength(3); // Top 3 only
  });

  it('should filter zero-confidence alternatives', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.8,
    };

    const alternatives: RoutingAlternative[] = [
      { targetId: 'agent-b', targetName: 'Agent B', confidence: 0.5 },
      { targetId: 'agent-c', targetName: 'Agent C', confidence: 0.0 }, // Zero
      { targetId: 'agent-d', targetName: 'Agent D', confidence: 0.0 }, // Zero
    ];

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.8,
      calibratedScore: 0.8,
      calibrated: false,
      observationCount: 10,
    };

    const explanation = generateRoutingExplanation(
      winner,
      alternatives,
      calibrationMetadata,
      'keyword'
    );

    // Should only include agent-b (non-zero)
    expect(explanation.alternatives).toHaveLength(1);
    expect(explanation.alternatives[0].targetId).toBe('agent-b');
  });

  it('should exclude winner from alternatives', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.9,
    };

    const alternatives: RoutingAlternative[] = [
      winner, // Duplicate winner
      { targetId: 'agent-b', targetName: 'Agent B', confidence: 0.7 },
    ];

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.9,
      calibratedScore: 0.9,
      calibrated: false,
      observationCount: 5,
    };

    const explanation = generateRoutingExplanation(
      winner,
      alternatives,
      calibrationMetadata,
      'exact'
    );

    // Should only include agent-b
    expect(explanation.alternatives).toHaveLength(1);
    expect(explanation.alternatives[0].targetId).toBe('agent-b');
  });

  it('should sort alternatives by confidence descending', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.95,
    };

    const alternatives: RoutingAlternative[] = [
      { targetId: 'agent-b', targetName: 'Agent B', confidence: 0.5 },
      { targetId: 'agent-c', targetName: 'Agent C', confidence: 0.8 },
      { targetId: 'agent-d', targetName: 'Agent D', confidence: 0.3 },
    ];

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.95,
      calibratedScore: 0.95,
      calibrated: false,
      observationCount: 0,
    };

    const explanation = generateRoutingExplanation(
      winner,
      alternatives,
      calibrationMetadata,
      'function'
    );

    // Should be sorted: agent-c (0.8), agent-b (0.5), agent-d (0.3)
    expect(explanation.alternatives[0].targetId).toBe('agent-c');
    expect(explanation.alternatives[1].targetId).toBe('agent-b');
    expect(explanation.alternatives[2].targetId).toBe('agent-d');
  });

  it('should handle empty alternatives gracefully', () => {
    const winner: RoutingAlternative = {
      targetId: 'agent-a',
      targetName: 'Agent A',
      confidence: 0.9,
    };

    const calibrationMetadata: CalibrationMetadata = {
      rawScore: 0.9,
      calibratedScore: 0.9,
      calibrated: true,
      observationCount: 100,
    };

    const explanation = generateRoutingExplanation(winner, [], calibrationMetadata, 'regex');

    expect(explanation.alternatives).toHaveLength(0);
    expect(explanation.narrative).not.toContain('Alternatives:');
  });
});
