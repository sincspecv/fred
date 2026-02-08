/**
 * Tests for config resolution and diagnostics
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveProjectConfig, resolveProjectConfigOrThrow } from '../../../packages/cli/src/project/resolve-config';
import { formatConfigDiagnostic, formatDiagnostics, aggregateDiagnostics } from '../../../packages/cli/src/project/diagnostics';

describe('config diagnostics', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'fred-config-test-'));
  });

  afterEach(() => {
    if (testRoot) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('formatConfigDiagnostic', () => {
    it('formats error message into structured diagnostic', () => {
      const error = new Error('Agent must have a platform');
      const diagnostic = formatConfigDiagnostic(error, '/path/to/fred.config.ts');

      expect(diagnostic.code).toBe('config-missing-field');
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.message).toBe('Agent must have a platform');
      expect(diagnostic.path).toBe('/path/to/fred.config.ts');
      expect(diagnostic.fix).toContain('platform');
    });

    it('extracts line and column from error message', () => {
      const error = new Error('Unexpected token at line 5, column 10');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.line).toBe(5);
      expect(diagnostic.column).toBe(10);
    });

    it('infers parse error code', () => {
      const error = new Error('Unexpected token in JSON at position 42');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.code).toBe('config-parse-error');
      expect(diagnostic.fix).toContain('JSON syntax');
    });

    it('infers missing field code', () => {
      const error = new Error('Pipeline "test" must have an id');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.code).toBe('config-missing-field');
      expect(diagnostic.fix).toContain('required field');
    });

    it('infers duplicate ID code', () => {
      const error = new Error('Duplicate pipeline ID found: "my-pipeline"');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.code).toBe('config-duplicate-id');
      expect(diagnostic.fix).toContain('unique');
    });

    it('infers unknown reference code', () => {
      const error = new Error('References unknown agent "missing-agent"');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.code).toBe('config-unknown-reference');
      expect(diagnostic.fix).toContain('Define');
    });

    it('handles string errors', () => {
      const diagnostic = formatConfigDiagnostic('Invalid configuration');

      expect(diagnostic.message).toBe('Invalid configuration');
      expect(diagnostic.code).toBe('config-validation-error');
    });

    it('cleans "Error:" prefix from message', () => {
      const error = new Error('Error: Something went wrong');
      const diagnostic = formatConfigDiagnostic(error);

      expect(diagnostic.message).toBe('Something went wrong');
    });
  });

  describe('formatDiagnostics', () => {
    it('formats multiple errors', () => {
      const errors = [
        new Error('Agent must have a platform'),
        new Error('Tool must have a name'),
      ];

      const diagnostics = formatDiagnostics(errors, '/path/to/config.ts');

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].message).toContain('platform');
      expect(diagnostics[1].message).toContain('name');
      expect(diagnostics[0].path).toBe('/path/to/config.ts');
      expect(diagnostics[1].path).toBe('/path/to/config.ts');
    });
  });

  describe('aggregateDiagnostics', () => {
    it('counts errors and warnings', () => {
      const diagnostics = [
        { code: 'e1', severity: 'error' as const, message: 'Error 1' },
        { code: 'e2', severity: 'error' as const, message: 'Error 2' },
        { code: 'w1', severity: 'warning' as const, message: 'Warning 1' },
      ];

      const result = aggregateDiagnostics(diagnostics);

      expect(result.errors).toBe(2);
      expect(result.warnings).toBe(1);
      expect(result.summary).toBe('Found 2 errors and 1 warning');
    });

    it('handles singular error', () => {
      const diagnostics = [
        { code: 'e1', severity: 'error' as const, message: 'Error' },
      ];

      const result = aggregateDiagnostics(diagnostics);

      expect(result.errors).toBe(1);
      expect(result.warnings).toBe(0);
      expect(result.summary).toBe('Found 1 error');
    });

    it('handles no diagnostics', () => {
      const result = aggregateDiagnostics([]);

      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(0);
      expect(result.summary).toBe('No issues found');
    });
  });

  describe('resolveProjectConfig', () => {
    it('returns success with valid config', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: [
            {
              id: 'test-agent',
              systemMessage: 'You are a test agent',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        })
      );

      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.configPath).toBe(configPath);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('returns diagnostic when config not found', () => {
      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(false);
      expect(result.config).toBeUndefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('config-not-found');
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].fix).toContain('fred.config');
    });

    it('returns diagnostic for invalid JSON', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(configPath, '{ invalid json }');

      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('config-parse-error');
      expect(result.diagnostics[0].path).toBe(configPath);
    });

    it('returns diagnostics for validation errors', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: [
            {
              id: 'test-agent',
              // Missing required fields: systemMessage, platform, model
            },
          ],
        })
      );

      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].path).toBe(configPath);
      expect(result.diagnostics[0].fix).toBeDefined();
    });

    it('aggregates multiple validation errors', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: [
            {
              id: 'agent1',
              // Missing systemMessage, platform, model
            },
            {
              // Missing id
              systemMessage: 'test',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        })
      );

      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(false);
      // Should catch first validation error (current implementation)
      // Future: could collect all errors in one pass
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('provides actionable fix hints', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          intents: [
            {
              id: 'test-intent',
              // Missing utterances and action
            },
          ],
        })
      );

      const result = resolveProjectConfig(testRoot);

      expect(result.success).toBe(false);
      expect(result.diagnostics[0].fix).toBeDefined();
      expect(result.diagnostics[0].fix).toMatch(/add|provide|ensure/i);
    });
  });

  describe('resolveProjectConfigOrThrow', () => {
    it('returns config when valid', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: [
            {
              id: 'test-agent',
              systemMessage: 'You are a test agent',
              platform: 'openai',
              model: 'gpt-4',
            },
          ],
        })
      );

      const result = resolveProjectConfigOrThrow(testRoot);

      expect(result.config).toBeDefined();
      expect(result.configPath).toBe(configPath);
    });

    it('throws with diagnostic details when invalid', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(configPath, '{ invalid }');

      expect(() => {
        resolveProjectConfigOrThrow(testRoot);
      }).toThrow(/Failed to resolve config/);
    });

    it('throws when config not found', () => {
      expect(() => {
        resolveProjectConfigOrThrow(testRoot);
      }).toThrow(/No Fred config file found/);
    });
  });
});
