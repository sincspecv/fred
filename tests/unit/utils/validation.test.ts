import { describe, test, expect } from 'bun:test';
import {
  validateId,
  validateMessageLength,
  validatePipelineAgentCount,
  validatePipelineMessageCount,
  validateRegexPattern,
  sanitizeError,
} from '../../../packages/core/src/utils/validation';

describe('Validation Utils', () => {
  describe('validateId', () => {
    test('should accept valid IDs', () => {
      expect(() => validateId('valid-id')).not.toThrow();
      expect(() => validateId('valid_id')).not.toThrow();
      expect(() => validateId('valid.id')).not.toThrow();
      expect(() => validateId('ValidID123')).not.toThrow();
      expect(() => validateId('valid-id_123.test')).not.toThrow();
    });

    test('should throw error for empty string', () => {
      expect(() => validateId('')).toThrow('ID must be a non-empty string');
    });

    test('should throw error for non-string', () => {
      expect(() => validateId(null as any)).toThrow('ID must be a non-empty string');
      expect(() => validateId(undefined as any)).toThrow('ID must be a non-empty string');
      expect(() => validateId(123 as any)).toThrow('ID must be a non-empty string');
    });

    test('should throw error for IDs exceeding max length', () => {
      const longId = 'a'.repeat(257);
      expect(() => validateId(longId)).toThrow('ID exceeds maximum length of 256 characters');
    });

    test('should accept IDs at max length', () => {
      const maxLengthId = 'a'.repeat(256);
      expect(() => validateId(maxLengthId)).not.toThrow();
    });

    test('should throw error for invalid characters', () => {
      expect(() => validateId('invalid id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid@id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid#id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid$id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid%id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid/id')).toThrow('contains invalid characters');
      expect(() => validateId('invalid\\id')).toThrow('contains invalid characters');
    });

    test('should use custom entity type in error message', () => {
      expect(() => validateId('', 'Agent ID')).toThrow('Agent ID must be a non-empty string');
      expect(() => validateId('invalid id', 'Pipeline ID')).toThrow('Pipeline ID contains invalid characters');
    });
  });

  describe('validateMessageLength', () => {
    test('should accept valid message lengths', () => {
      expect(() => validateMessageLength('short message')).not.toThrow();
      expect(() => validateMessageLength('a'.repeat(1000))).not.toThrow();
      expect(() => validateMessageLength('a'.repeat(1000000))).not.toThrow();
    });

    test('should throw error for non-string', () => {
      expect(() => validateMessageLength(null as any)).toThrow('Message must be a string');
      expect(() => validateMessageLength(123 as any)).toThrow('Message must be a string');
      expect(() => validateMessageLength({} as any)).toThrow('Message must be a string');
    });

    test('should throw error for messages exceeding max length', () => {
      const longMessage = 'a'.repeat(1000001);
      expect(() => validateMessageLength(longMessage)).toThrow('Message exceeds maximum length of 1000000 characters');
    });

    test('should accept messages at max length', () => {
      const maxLengthMessage = 'a'.repeat(1000000);
      expect(() => validateMessageLength(maxLengthMessage)).not.toThrow();
    });
  });

  describe('validatePipelineAgentCount', () => {
    test('should accept valid agent counts', () => {
      expect(() => validatePipelineAgentCount(1)).not.toThrow();
      expect(() => validatePipelineAgentCount(10)).not.toThrow();
      expect(() => validatePipelineAgentCount(100)).not.toThrow();
    });

    test('should throw error for zero agents', () => {
      expect(() => validatePipelineAgentCount(0)).toThrow('Pipeline must have at least one agent');
    });

    test('should throw error for exceeding max agents', () => {
      expect(() => validatePipelineAgentCount(101)).toThrow('Pipeline exceeds maximum agent count of 100');
    });

    test('should accept max agent count', () => {
      expect(() => validatePipelineAgentCount(100)).not.toThrow();
    });
  });

  describe('validatePipelineMessageCount', () => {
    test('should accept valid message counts', () => {
      expect(() => validatePipelineMessageCount(0)).not.toThrow();
      expect(() => validatePipelineMessageCount(10)).not.toThrow();
      expect(() => validatePipelineMessageCount(1000)).not.toThrow();
    });

    test('should throw error for exceeding max messages', () => {
      expect(() => validatePipelineMessageCount(1001)).toThrow('Pipeline message accumulation exceeds maximum of 1000 messages');
    });

    test('should accept max message count', () => {
      expect(() => validatePipelineMessageCount(1000)).not.toThrow();
    });
  });

  describe('validateRegexPattern', () => {
    test('should accept valid regex patterns', () => {
      expect(validateRegexPattern('^hello$')).toBe(true);
      expect(validateRegexPattern('hello.*world')).toBe(true);
      expect(validateRegexPattern('[0-9]+')).toBe(true);
      expect(validateRegexPattern('(hello|world)')).toBe(true);
    });

    test('should reject non-string input', () => {
      expect(validateRegexPattern(null as any)).toBe(false);
      expect(validateRegexPattern(123 as any)).toBe(false);
      expect(validateRegexPattern({} as any)).toBe(false);
    });

    test('should reject patterns exceeding max length', () => {
      const longPattern = 'a'.repeat(1001);
      expect(validateRegexPattern(longPattern)).toBe(false);
    });

    test('should reject dangerous nested quantifier patterns', () => {
      // Nested + quantifiers
      expect(validateRegexPattern('(a+)+')).toBe(false);
      expect(validateRegexPattern('(hello+)+')).toBe(false);

      // Nested * quantifiers
      expect(validateRegexPattern('(a*)*')).toBe(false);
      expect(validateRegexPattern('(hello*)*')).toBe(false);

      // Nested ? quantifiers
      expect(validateRegexPattern('(a?)?')).toBe(false);

      // Nested {} quantifiers
      expect(validateRegexPattern('(a{1,2}){1,2}')).toBe(false);
    });

    test('should accept safe patterns with quantifiers', () => {
      expect(validateRegexPattern('a+')).toBe(true);
      expect(validateRegexPattern('a*')).toBe(true);
      expect(validateRegexPattern('a?')).toBe(true);
      expect(validateRegexPattern('a{1,2}')).toBe(true);
      expect(validateRegexPattern('(hello)+')).toBe(true);
      expect(validateRegexPattern('(hello)*')).toBe(true);
    });

    test('should reject invalid regex syntax', () => {
      expect(validateRegexPattern('[')).toBe(false); // Unclosed bracket
      expect(validateRegexPattern('(hello')).toBe(false); // Unclosed parenthesis
    });

    test('should accept complex but safe patterns', () => {
      expect(validateRegexPattern('^[a-zA-Z0-9]+$')).toBe(true);
      expect(validateRegexPattern('\\d{4}-\\d{2}-\\d{2}')).toBe(true);
      expect(validateRegexPattern('(hello|world|test)')).toBe(true);
    });
  });

  describe('sanitizeError', () => {
    test('should sanitize error messages with absolute paths', () => {
      const error = new Error('File not found: /home/user/secret/file.txt');
      const sanitized = sanitizeError(error);

      expect(sanitized.message).toContain('[path]');
      expect(sanitized.message).not.toContain('/home/user/secret/file.txt');
    });

    test('should sanitize API keys in error messages', () => {
      const error = new Error('Invalid api_key: sk-1234567890abcdef');
      const sanitized = sanitizeError(error);

      expect(sanitized.message).toContain('[redacted]');
      expect(sanitized.message).not.toContain('sk-1234567890abcdef');
    });

    test('should sanitize tokens in error messages', () => {
      const error = new Error('Invalid token: abc123xyz');
      const sanitized = sanitizeError(error);

      expect(sanitized.message).toContain('token=[redacted]');
      expect(sanitized.message).not.toContain('abc123xyz');
    });

    test('should handle errors with context', () => {
      const error = new Error('Something went wrong');
      const sanitized = sanitizeError(error, 'Test Context');

      expect(sanitized.message).toContain('Test Context');
      expect(sanitized.message).toContain('Something went wrong');
    });

    test('should handle non-Error objects', () => {
      const sanitized = sanitizeError('string error');
      expect(sanitized.message).toBe('Unknown error');
    });

    test('should handle non-Error objects with context', () => {
      const sanitized = sanitizeError(null, 'Test Context');
      expect(sanitized.message).toBe('Test Context: Unknown error');
    });

    test('should preserve original error message when no sensitive data', () => {
      const error = new Error('Simple error message');
      const sanitized = sanitizeError(error);

      expect(sanitized.message).toBe('Simple error message');
    });

    test('should handle multiple path patterns', () => {
      const error = new Error('Files: /path1/file1.txt and /path2/file2.txt');
      const sanitized = sanitizeError(error);

      expect(sanitized.message).toContain('[path]');
      expect(sanitized.message.split('[path]').length).toBeGreaterThan(2);
    });
  });
});
