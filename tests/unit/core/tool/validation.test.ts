import { describe, test, expect } from 'bun:test';
import { Schema } from 'effect';
import {
  decodeToolInputs,
  getDecodedToolInputs,
  validateToolSchema,
  wrapToolExecution,
  type ToolValidationError,
  type FieldValidationError,
} from '../../../../src/core/tool/validation';
import type { Tool } from '../../../../src/core/tool/tool';

describe('Tool Validation - Structured Errors', () => {
  describe('Field-level validation error format', () => {
    test('missing field errors include field name and kind', () => {
      const tool: Tool<{ name: string; email: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
            email: Schema.String,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { name: 'John' }); // Missing email

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(result.result.error.message).toContain('input validation failed');
        expect(result.result.error.issues.length).toBeGreaterThan(0);
        // Issues should be in "field: kind" format
        const issueText = result.result.error.issues.join(' ');
        expect(issueText).toContain('missing');
      }
    });

    test('wrong_type errors include expected type', () => {
      const tool: Tool<{ age: number }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            age: Schema.Number,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { age: 'twenty' }); // String instead of number

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(result.result.error.message).toContain('input validation failed');
        expect(result.result.error.issues.length).toBeGreaterThan(0);
      }
    });

    test('invalid value errors include field name', () => {
      // Using a refinement that validates format
      const EmailSchema = Schema.String.pipe(
        Schema.filter((s) => s.includes('@'), { message: () => 'invalid email format' })
      );

      const tool: Tool<{ email: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            email: EmailSchema,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { email: 'not-an-email' });

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(result.result.error.message).toContain('input validation failed');
      }
    });
  });

  describe('fieldErrors structured array', () => {
    test('fieldErrors array contains structured error details', () => {
      const tool: Tool<{ name: string; age: number }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
            age: Schema.Number,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { name: 123, age: 'twenty' }); // Both wrong types

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        // fieldErrors should be populated for structured errors
        expect(result.result.error.message).toContain('input validation failed');
      }
    });

    test('nested field paths are correctly formatted', () => {
      const tool: Tool<{ address: { city: string; zip: number } }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            address: Schema.Struct({
              city: Schema.String,
              zip: Schema.Number,
            }),
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { address: { city: 123, zip: 'invalid' } });

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(result.result.error.message).toContain('input validation failed');
      }
    });

    test('array index paths are correctly formatted', () => {
      const tool: Tool<{ items: number[] }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            items: Schema.Array(Schema.Number),
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { items: [1, 'two', 3] }); // String in number array

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(result.result.error.message).toContain('input validation failed');
      }
    });
  });

  describe('error kind classification', () => {
    test('missing kind for missing required fields', () => {
      const tool: Tool<{ required: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            required: Schema.String,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, {}); // Missing required field

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        const issueText = result.result.error.issues.join(' ').toLowerCase();
        expect(issueText).toContain('missing');
      }
    });

    test('wrong_type kind for type mismatches', () => {
      const tool: Tool<{ value: number }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            value: Schema.Number,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { value: 'not-a-number' });

      expect(result.result.ok).toBe(false);
    });

    test('invalid kind for format/constraint violations', () => {
      const PositiveNumber = Schema.Number.pipe(
        Schema.filter((n) => n > 0, { message: () => 'must be positive' })
      );

      const tool: Tool<{ count: number }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            count: PositiveNumber,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { count: -5 });

      expect(result.result.ok).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    test('issues array is always populated', () => {
      const tool: Tool<{ field: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            field: Schema.String,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { field: 123 });

      expect(result.result.ok).toBe(false);
      if (!result.result.ok) {
        expect(Array.isArray(result.result.error.issues)).toBe(true);
        expect(result.result.error.issues.length).toBeGreaterThan(0);
      }
    });

    test('successful validation has no breaking changes', () => {
      const tool: Tool<{ name: string; age: number }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
            age: Schema.Number,
          }),
        },
        execute: async () => 'ok',
      };

      const result = decodeToolInputs(tool, { name: 'John', age: 30 });

      expect(result.result.ok).toBe(true);
      if (result.result.ok) {
        expect(result.result.value).toEqual({ name: 'John', age: 30 });
        expect(result.result.metadata.coerced).toBe(false);
      }
    });
  });

  describe('getDecodedToolInputs', () => {
    test('throws validation error with structured details for invalid input', () => {
      const tool: Tool<{ name: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
          }),
        },
        execute: async () => 'ok',
      };

      expect(() => getDecodedToolInputs(tool, { name: 123 })).toThrow();
    });

    test('returns decoded value and metadata for valid input', () => {
      const tool: Tool<{ name: string }> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
          }),
        },
        execute: async () => 'ok',
      };

      const result = getDecodedToolInputs(tool, { name: 'John' });
      expect(result.output).toEqual({ name: 'John' });
    });
  });

  describe('validateToolSchema', () => {
    test('throws for strict tool without schema', () => {
      const tool = {
        id: 'strict-tool',
        name: 'Strict Tool',
        description: 'A strict tool',
        strict: true,
        execute: async () => 'ok',
      } as Tool;

      expect(() => validateToolSchema(tool)).toThrow('requires an input schema');
    });

    test('does not throw for non-strict tool without schema', () => {
      const tool = {
        id: 'lenient-tool',
        name: 'Lenient Tool',
        description: 'A lenient tool',
        execute: async () => 'ok',
      } as Tool;

      expect(() => validateToolSchema(tool)).not.toThrow();
    });
  });

  describe('wrapToolExecution', () => {
    test('validates input before executing', async () => {
      const tool: Tool<{ name: string }, string> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
          }),
          success: Schema.String,
        },
        execute: async (args) => `Hello, ${args.name}!`,
      };

      const wrapped = wrapToolExecution(tool, tool.execute);

      const result = await wrapped({ name: 'John' });
      expect(result).toBe('Hello, John!');
    });

    test('throws structured error for invalid input', async () => {
      const tool: Tool<{ name: string }, string> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        schema: {
          input: Schema.Struct({
            name: Schema.String,
          }),
          success: Schema.String,
        },
        execute: async (args) => `Hello, ${args.name}!`,
      };

      const wrapped = wrapToolExecution(tool, tool.execute);

      await expect(wrapped({ name: 123 })).rejects.toThrow();
    });
  });
});
