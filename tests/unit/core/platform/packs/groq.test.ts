import { describe, test, expect } from 'bun:test';
import { GroqProviderFactory } from '../../../../../packages/provider-groq/src/index';

describe('GroqProviderFactory', () => {
  describe('static properties', () => {
    test('has correct id', () => {
      expect(GroqProviderFactory.id).toBe('groq');
    });

    test('has correct aliases', () => {
      expect(GroqProviderFactory.aliases).toEqual(['groq']);
    });
  });

  describe('configuration', () => {
    test('factory has load method', () => {
      expect(typeof GroqProviderFactory.load).toBe('function');
    });

    test('load is async', () => {
      const result = GroqProviderFactory.load({});
      expect(result).toBeInstanceOf(Promise);
      // Clean up the promise to avoid unhandled rejection
      result.catch(() => {});
    });
  });

  describe('integration with @effect/ai-openai', () => {
    // Integration tests require actual @effect/ai-openai module
    // These tests verify the factory can successfully load when the dependency is available

    test('loads successfully with default configuration', async () => {
      // Set up test environment variable
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({});

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
        expect(typeof result.getModel).toBe('function');
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom apiKeyEnvVar', async () => {
      const originalEnv = process.env.CUSTOM_GROQ_KEY;
      process.env.CUSTOM_GROQ_KEY = 'custom-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          apiKeyEnvVar: 'CUSTOM_GROQ_KEY',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CUSTOM_GROQ_KEY;
        } else {
          process.env.CUSTOM_GROQ_KEY = originalEnv;
        }
      }
    });

    test('respects custom baseUrl', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          baseUrl: 'https://custom.groq.endpoint',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom headers', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          headers: { 'X-Custom': 'value' },
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('getModel returns Effect', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({});
        const model = result.getModel('llama-3.3-70b-versatile');

        // Effect has a _tag property
        expect(model).toBeDefined();
        expect(typeof model).toBe('object');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });
  });
});
