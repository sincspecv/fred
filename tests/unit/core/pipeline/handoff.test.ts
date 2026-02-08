import { describe, test, expect } from 'bun:test';
import {
  validateHandoffTarget,
  prepareHandoffContext,
  isHandoffResult,
  type HandoffConfig,
  type HandoffRequest,
  type PipelineContext,
} from '../../../../packages/core/src/pipeline';

describe('Handoff Validation', () => {
  describe('validateHandoffTarget', () => {
    test('should return success for allowed target', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing', 'technical', 'returns'],
      };

      const request: HandoffRequest = {
        targetAgent: 'billing',
      };

      const result = validateHandoffTarget(request, config);

      expect(result.success).toBe(true);
      expect(result.targetAgent).toBe('billing');
      expect(result.type).toBe('handoff');
    });

    test('should return failure with error for disallowed target', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing', 'technical'],
      };

      const request: HandoffRequest = {
        targetAgent: 'unknown-agent',
      };

      const result = validateHandoffTarget(request, config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "Handoff to 'unknown-agent' not allowed. Available: billing, technical"
        );
      }
      expect(result.targetAgent).toBe('unknown-agent');
      expect(result.type).toBe('handoff');
    });

    test('should validate all allowed targets', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing', 'technical', 'returns'],
      };

      expect(validateHandoffTarget({ targetAgent: 'billing' }, config).success).toBe(true);
      expect(validateHandoffTarget({ targetAgent: 'technical' }, config).success).toBe(true);
      expect(validateHandoffTarget({ targetAgent: 'returns' }, config).success).toBe(true);
      expect(validateHandoffTarget({ targetAgent: 'other' }, config).success).toBe(false);
    });
  });

  describe('prepareHandoffContext', () => {
    test('should include full history and metadata by default', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing'],
      };

      const pipelineContext: PipelineContext = {
        pipelineId: 'pipeline-1',
        input: 'I need help with my bill',
        outputs: { step1: 'result1' },
        history: [
          { role: 'user', content: 'I need help with my bill' },
          { role: 'assistant', content: 'Let me route you to billing' },
        ],
        metadata: { sessionId: 'session-123' },
      };

      const request: HandoffRequest = {
        targetAgent: 'billing',
        reason: 'billing inquiry',
        metadata: { priority: 'high' },
      };

      const context = prepareHandoffContext(request, pipelineContext, config);

      expect(context.input).toBe('I need help with my bill');
      expect(context.history).toHaveLength(2);
      expect(context.outputs).toEqual({ step1: 'result1' });
      expect(context.metadata.handoffFrom).toBe('triage');
      expect(context.metadata.handoffReason).toBe('billing inquiry');
      expect(context.metadata.handoffDepth).toBe(0); // New: depth tracking for observability
      expect(context.metadata.priority).toBe('high');
      expect(context.metadata.sessionId).toBe('session-123');
    });

    test('should clear history when preserveHistory is false', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing'],
        preserveHistory: false,
      };

      const pipelineContext: PipelineContext = {
        pipelineId: 'pipeline-1',
        input: 'I need help with my bill',
        outputs: { step1: 'result1' },
        history: [
          { role: 'user', content: 'I need help with my bill' },
          { role: 'assistant', content: 'Let me route you to billing' },
        ],
        metadata: {},
      };

      const request: HandoffRequest = {
        targetAgent: 'billing',
      };

      const context = prepareHandoffContext(request, pipelineContext, config);

      expect(context.history).toEqual([]);
      expect(context.input).toBe('I need help with my bill');
      expect(context.outputs).toEqual({ step1: 'result1' });
    });

    test('should work without optional request fields', () => {
      const config: HandoffConfig = {
        sourceAgent: 'triage',
        allowedTargets: ['billing'],
      };

      const pipelineContext: PipelineContext = {
        pipelineId: 'pipeline-1',
        input: 'Help',
        outputs: {},
        history: [],
        metadata: {},
      };

      const request: HandoffRequest = {
        targetAgent: 'billing',
      };

      const context = prepareHandoffContext(request, pipelineContext, config);

      expect(context.metadata.handoffFrom).toBe('triage');
      expect(context.metadata.handoffReason).toBeUndefined();
      expect(context.metadata.handoffDepth).toBe(0); // New: depth tracking for observability
      expect(Object.keys(context.metadata)).toHaveLength(2); // handoffFrom + handoffDepth
    });
  });

  describe('isHandoffResult', () => {
    test('should return true for valid success result', () => {
      const result = {
        type: 'handoff',
        targetAgent: 'billing',
        success: true,
      };

      expect(isHandoffResult(result)).toBe(true);
    });

    test('should return true for valid failure result', () => {
      const result = {
        type: 'handoff',
        targetAgent: 'billing',
        success: false,
        error: 'Not allowed',
      };

      expect(isHandoffResult(result)).toBe(true);
    });

    test('should return false for non-handoff type', () => {
      const result = {
        type: 'other',
        targetAgent: 'billing',
        success: true,
      };

      expect(isHandoffResult(result)).toBe(false);
    });

    test('should return false for missing targetAgent', () => {
      const result = {
        type: 'handoff',
        success: true,
      };

      expect(isHandoffResult(result)).toBe(false);
    });

    test('should return false for missing success field', () => {
      const result = {
        type: 'handoff',
        targetAgent: 'billing',
      };

      expect(isHandoffResult(result)).toBe(false);
    });

    test('should return false for failure without error', () => {
      const result = {
        type: 'handoff',
        targetAgent: 'billing',
        success: false,
      };

      expect(isHandoffResult(result)).toBe(false);
    });

    test('should return false for non-object values', () => {
      expect(isHandoffResult(null)).toBe(false);
      expect(isHandoffResult(undefined)).toBe(false);
      expect(isHandoffResult('string')).toBe(false);
      expect(isHandoffResult(123)).toBe(false);
      expect(isHandoffResult(true)).toBe(false);
    });
  });
});
