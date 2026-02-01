import { describe, test, expect } from 'bun:test';
import { isFilePath, loadPromptFile } from '../../../packages/core/src/utils/prompt-loader';

describe('Prompt Loader', () => {

  describe('isFilePath', () => {
    test('should detect relative paths starting with ./', () => {
      expect(isFilePath('./file.md')).toBe(true);
      expect(isFilePath('./path/to/file.md')).toBe(true);
    });

    test('should detect relative paths starting with ../', () => {
      expect(isFilePath('../file.md')).toBe(true);
      expect(isFilePath('../../file.md')).toBe(true);
    });

    test('should detect absolute paths starting with /', () => {
      expect(isFilePath('/path/to/file.md')).toBe(true);
      expect(isFilePath('/file.md')).toBe(true);
    });

    test('should detect paths starting with ~', () => {
      expect(isFilePath('~/file.md')).toBe(true);
      expect(isFilePath('~/path/to/file.md')).toBe(true);
    });

    test('should detect .md extension', () => {
      expect(isFilePath('file.md')).toBe(true);
      expect(isFilePath('path/to/file.md')).toBe(true);
    });

    test('should detect .markdown extension', () => {
      expect(isFilePath('file.markdown')).toBe(true);
      expect(isFilePath('FILE.MARKDOWN')).toBe(true); // case insensitive
    });

    test('should not detect regular strings as file paths', () => {
      expect(isFilePath('You are a helpful assistant')).toBe(false);
      expect(isFilePath('hello world')).toBe(false);
      expect(isFilePath('agent instructions')).toBe(false);
    });

    test('should not detect strings without path indicators', () => {
      expect(isFilePath('file.txt')).toBe(false); // .txt not recognized
      expect(isFilePath('file.js')).toBe(false);
      expect(isFilePath('plain text')).toBe(false);
    });
  });

  describe('loadPromptFile', () => {
    test('should return string as-is when not a file path', () => {
      const result = loadPromptFile('You are a helpful assistant');
      expect(result).toBe('You are a helpful assistant');
    });

    test('should return string as-is for plain text', () => {
      const result = loadPromptFile('This is plain text content');
      expect(result).toBe('This is plain text content');
    });

    describe('path validation', () => {
      test('should reject absolute paths by default', () => {
        let errorThrown = false;
        try {
          loadPromptFile('/absolute/path/to/file.md', '/path/to/config.yaml');
        } catch (error) {
          errorThrown = true;
          expect(error instanceof Error).toBe(true);
          expect((error as Error).message).toContain('Absolute paths are not allowed');
        }
        expect(errorThrown).toBe(true);
      });

      test('should prevent path traversal attacks', () => {
        let errorThrown = false;
        try {
          loadPromptFile('../../../../etc/passwd', '/path/to/config.yaml');
        } catch (error) {
          errorThrown = true;
          expect(error instanceof Error).toBe(true);
          expect((error as Error).message).toContain('Path traversal detected');
        }
        expect(errorThrown).toBe(true);
      });

      test('should prevent path traversal with basePath', () => {
        let errorThrown = false;
        try {
          loadPromptFile('../../../etc/passwd', '/safe/directory/config.yaml');
        } catch (error) {
          errorThrown = true;
          expect(error instanceof Error).toBe(true);
          expect((error as Error).message).toContain('Path traversal detected');
        }
        expect(errorThrown).toBe(true);
      });

      test('should allow valid relative paths within sandbox', () => {
        // Should not throw for valid relative paths
        // Note: This may return the original string if file doesn't exist, which is expected behavior
        expect(() => {
          loadPromptFile('./prompts/agent.md', '/path/to/config.yaml');
        }).not.toThrow();
      });

      test('should allow paths in subdirectories', () => {
        // Should not throw for valid relative paths
        expect(() => {
          loadPromptFile('prompts/agent.md', '/path/to/config.yaml');
        }).not.toThrow();
      });
    });

    describe('edge cases', () => {
      test('should handle empty string', () => {
        const result = loadPromptFile('');
        expect(result).toBe('');
      });

      test('should handle case-insensitive .md detection', () => {
        expect(isFilePath('file.MD')).toBe(true);
        expect(isFilePath('file.Markdown')).toBe(true);
      });
    });
  });
});
