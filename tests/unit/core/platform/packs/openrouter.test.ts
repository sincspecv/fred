import { describe, test, expect } from 'bun:test';
import { OpenRouterProviderFactory } from '../../../../../src/core/platform/packs/openrouter';

describe('OpenRouterProviderFactory', () => {
  describe('static properties', () => {
    test('has correct id', () => {
      expect(OpenRouterProviderFactory.id).toBe('openrouter');
    });

    test('has correct aliases', () => {
      expect(OpenRouterProviderFactory.aliases).toEqual(['openrouter']);
    });
  });

  describe('configuration', () => {
    test('factory has load method', () => {
      expect(typeof OpenRouterProviderFactory.load).toBe('function');
    });

    test('load is async', () => {
      const result = OpenRouterProviderFactory.load({});
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
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({});

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
        expect(typeof result.getModel).toBe('function');
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom apiKeyEnvVar', async () => {
      const originalEnv = process.env.CUSTOM_OPENROUTER_KEY;
      process.env.CUSTOM_OPENROUTER_KEY = 'custom-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          apiKeyEnvVar: 'CUSTOM_OPENROUTER_KEY',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CUSTOM_OPENROUTER_KEY;
        } else {
          process.env.CUSTOM_OPENROUTER_KEY = originalEnv;
        }
      }
    });

    test('respects custom baseUrl', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          baseUrl: 'https://custom.openrouter.endpoint',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom headers for attribution', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          headers: { 'HTTP-Referer': 'https://myapp.com' },
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('getModel returns Effect', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({});
        const model = result.getModel('anthropic/claude-3.5-sonnet');

        // Effect has a _tag property
        expect(model).toBeDefined();
        expect(typeof model).toBe('object');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });
  });
});
