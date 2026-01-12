import { describe, test, expect } from 'bun:test';
import { calculateSimilarity, semanticMatch } from '../../../src/utils/semantic';

describe('Semantic Utils', () => {
  describe('calculateSimilarity', () => {
    test('should return 1.0 for identical strings', () => {
      expect(calculateSimilarity('hello', 'hello')).toBe(1.0);
      expect(calculateSimilarity('test string', 'test string')).toBe(1.0);
    });

    test('should return 1.0 when both strings are empty', () => {
      expect(calculateSimilarity('', '')).toBe(1.0);
    });

    test('should return 0.0 when one string is empty and other is not', () => {
      // When one string is empty and the other has content, similarity is 0
      expect(calculateSimilarity('', 'a')).toBe(0.0);
      expect(calculateSimilarity('a', '')).toBe(0.0);
    });

    test('should calculate similarity for similar strings', () => {
      const similarity = calculateSimilarity('hello', 'hallo');
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1.0);
    });

    test('should return 0.0 for completely different strings', () => {
      const similarity = calculateSimilarity('abc', 'xyz');
      expect(similarity).toBe(0.0);
    });

    test('should handle strings of different lengths', () => {
      const similarity1 = calculateSimilarity('hello', 'hello world');
      expect(similarity1).toBeGreaterThan(0);
      expect(similarity1).toBeLessThan(1.0);

      const similarity2 = calculateSimilarity('hello world', 'hello');
      expect(similarity2).toBeGreaterThan(0);
      expect(similarity2).toBeLessThan(1.0);
    });

    test('should be case-sensitive in calculation but normalized in semanticMatch', () => {
      // calculateSimilarity itself is case-sensitive
      const similarity1 = calculateSimilarity('Hello', 'hello');
      expect(similarity1).toBeLessThan(1.0);

      const similarity2 = calculateSimilarity('HELLO', 'hello');
      expect(similarity2).toBeLessThan(1.0);
    });

    test('should handle single character differences', () => {
      const similarity = calculateSimilarity('hello', 'hallo');
      // Should be high similarity (4/5 = 0.8)
      expect(similarity).toBe(0.8);
    });

    test('should handle multiple character differences', () => {
      const similarity = calculateSimilarity('hello', 'world');
      expect(similarity).toBeLessThan(0.5);
    });

    test('should handle very long strings', () => {
      const str1 = 'a'.repeat(100);
      const str2 = 'b'.repeat(100);
      const similarity = calculateSimilarity(str1, str2);
      expect(similarity).toBe(0.0); // All characters different
    });

    test('should handle strings with same length but different content', () => {
      const similarity = calculateSimilarity('abcde', 'vwxyz');
      expect(similarity).toBe(0.0);
    });

    test('should handle partial matches', () => {
      const similarity = calculateSimilarity('hello world', 'hello');
      // 5 matching characters out of 11
      expect(similarity).toBeCloseTo(5 / 11, 1);
    });
  });

  describe('semanticMatch', () => {
    test('should match identical utterance', async () => {
      const result = await semanticMatch('hello', ['hello']);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.utterance).toBe('hello');
    });

    test('should match similar utterance above threshold', async () => {
      const result = await semanticMatch('hello', ['hallo'], 0.7);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.utterance).toBe('hallo');
    });

    test('should not match when similarity below threshold', async () => {
      const result = await semanticMatch('hello', ['world'], 0.6);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    test('should return best match from multiple utterances', async () => {
      const result = await semanticMatch('hello', ['world', 'hello', 'test'], 0.6);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.utterance).toBe('hello');
    });

    test('should return best match even if not perfect', async () => {
      const result = await semanticMatch('hello', ['hallo', 'world', 'test'], 0.7);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.utterance).toBe('hallo');
    });

    test('should be case-insensitive', async () => {
      const result = await semanticMatch('HELLO', ['hello'], 0.6);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test('should use default threshold of 0.6', async () => {
      // Similarity of 'hello' and 'hallo' is 0.8, which is above 0.6
      const result = await semanticMatch('hello', ['hallo']);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.8);
    });

    test('should return no match when all utterances below threshold', async () => {
      const result = await semanticMatch('hello', ['xyz', 'abc', 'def'], 0.6);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    test('should handle empty utterances array', async () => {
      const result = await semanticMatch('hello', []);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    test('should handle empty message', async () => {
      // Empty message compared to non-empty utterance has 0 similarity
      const result = await semanticMatch('', ['hello'], 0.6);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });

    test('should handle threshold of 0.0 (match everything)', async () => {
      const result = await semanticMatch('hello', ['world'], 0.0);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should handle threshold of 1.0 (exact match only)', async () => {
      const result1 = await semanticMatch('hello', ['hello'], 1.0);
      expect(result1.matched).toBe(true);

      const result2 = await semanticMatch('hello', ['hallo'], 1.0);
      expect(result2.matched).toBe(false);
    });

    test('should select utterance with highest confidence', async () => {
      // 'hello' matches 'hello' (1.0) better than 'hallo' (0.8)
      const result = await semanticMatch('hello', ['hallo', 'hello', 'test'], 0.6);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.utterance).toBe('hello');
    });

    test('should handle special characters', async () => {
      const result = await semanticMatch('hello!', ['hello!'], 0.6);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test('should handle unicode characters', async () => {
      const result = await semanticMatch('café', ['cafe'], 0.6);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.6);
    });
  });
});
