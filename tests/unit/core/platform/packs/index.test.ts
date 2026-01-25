import { describe, test, expect } from 'bun:test';
import {
  BUILTIN_PACKS,
  loadBuiltinPack,
  isBuiltinPack,
  getBuiltinPackIds,
} from '../../../../../src/core/platform/packs/index';

describe('Built-in Pack Registry', () => {
  describe('BUILTIN_PACKS', () => {
    test('includes groq provider', () => {
      expect(BUILTIN_PACKS.groq).toBeDefined();
      expect(BUILTIN_PACKS.groq.id).toBe('groq');
    });

    test('includes openrouter provider', () => {
      expect(BUILTIN_PACKS.openrouter).toBeDefined();
      expect(BUILTIN_PACKS.openrouter.id).toBe('openrouter');
    });

    test('includes all expected providers', () => {
      const expectedProviders = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      const actualProviders = Object.keys(BUILTIN_PACKS).sort();

      expect(actualProviders).toEqual(expectedProviders);
    });

    test('all providers have required factory properties', () => {
      Object.entries(BUILTIN_PACKS).forEach(([key, factory]) => {
        expect(factory.id).toBeDefined();
        expect(typeof factory.id).toBe('string');
        expect(factory.aliases).toBeDefined();
        expect(Array.isArray(factory.aliases)).toBe(true);
        expect(typeof factory.load).toBe('function');
      });
    });
  });

  describe('loadBuiltinPack', () => {
    test('loads groq provider by id', () => {
      const pack = loadBuiltinPack('groq');
      expect(pack).not.toBeNull();
      expect(pack?.id).toBe('groq');
    });

    test('loads openrouter provider by id', () => {
      const pack = loadBuiltinPack('openrouter');
      expect(pack).not.toBeNull();
      expect(pack?.id).toBe('openrouter');
    });

    test('loads groq with case-insensitive id', () => {
      expect(loadBuiltinPack('GROQ')?.id).toBe('groq');
      expect(loadBuiltinPack('Groq')?.id).toBe('groq');
    });

    test('loads openrouter with case-insensitive id', () => {
      expect(loadBuiltinPack('OPENROUTER')?.id).toBe('openrouter');
      expect(loadBuiltinPack('OpenRouter')?.id).toBe('openrouter');
    });

    test('returns null for non-existent provider', () => {
      expect(loadBuiltinPack('nonexistent')).toBeNull();
    });

    test('loads all built-in providers', () => {
      const providers = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      providers.forEach((id) => {
        const pack = loadBuiltinPack(id);
        expect(pack).not.toBeNull();
        expect(pack?.id).toBe(id);
      });
    });
  });

  describe('isBuiltinPack', () => {
    test('returns true for groq', () => {
      expect(isBuiltinPack('groq')).toBe(true);
    });

    test('returns true for openrouter', () => {
      expect(isBuiltinPack('openrouter')).toBe(true);
    });

    test('returns true for groq with different casing', () => {
      expect(isBuiltinPack('GROQ')).toBe(true);
      expect(isBuiltinPack('Groq')).toBe(true);
    });

    test('returns true for openrouter with different casing', () => {
      expect(isBuiltinPack('OPENROUTER')).toBe(true);
      expect(isBuiltinPack('OpenRouter')).toBe(true);
    });

    test('returns false for non-existent provider', () => {
      expect(isBuiltinPack('nonexistent')).toBe(false);
    });

    test('returns true for all built-in providers', () => {
      const providers = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
      providers.forEach((id) => {
        expect(isBuiltinPack(id)).toBe(true);
      });
    });
  });

  describe('getBuiltinPackIds', () => {
    test('includes groq and openrouter', () => {
      // This verifies success criteria #3: providers appear in /providers command
      // The /providers command uses getBuiltinPackIds() to list available providers
      const ids = getBuiltinPackIds();
      expect(ids).toContain('groq');
      expect(ids).toContain('openrouter');
    });

    test('returns all expected provider ids', () => {
      const ids = getBuiltinPackIds();
      const expected = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];

      expect(ids.sort()).toEqual(expected);
    });

    test('returns array of strings', () => {
      const ids = getBuiltinPackIds();
      expect(Array.isArray(ids)).toBe(true);
      ids.forEach((id) => {
        expect(typeof id).toBe('string');
      });
    });

    test('each id corresponds to a valid pack', () => {
      const ids = getBuiltinPackIds();
      ids.forEach((id) => {
        expect(BUILTIN_PACKS[id]).toBeDefined();
        expect(BUILTIN_PACKS[id].id).toBe(id);
      });
    });
  });
});
