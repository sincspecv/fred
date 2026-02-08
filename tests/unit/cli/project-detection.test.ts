/**
 * Tests for project detection and config resolution
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectProjectRoot, findCandidateConfigs } from '../../../packages/cli/src/project/detect';

describe('project detection', () => {
  let testRoot: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    testRoot = mkdtempSync(join(tmpdir(), 'fred-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (testRoot) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('findCandidateConfigs', () => {
    it('returns empty array when no config files exist', () => {
      const candidates = findCandidateConfigs(testRoot);
      expect(candidates).toEqual([]);
    });

    it('finds fred.config.ts', () => {
      const configPath = join(testRoot, 'fred.config.ts');
      writeFileSync(configPath, 'export default {}');

      const candidates = findCandidateConfigs(testRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].path).toBe(configPath);
      expect(candidates[0].format).toBe('ts');
      expect(candidates[0].directory).toBe(testRoot);
    });

    it('finds fred.config.json', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(configPath, '{}');

      const candidates = findCandidateConfigs(testRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].path).toBe(configPath);
      expect(candidates[0].format).toBe('json');
    });

    it('returns ts before json when both exist (precedence)', () => {
      const tsPath = join(testRoot, 'fred.config.ts');
      const jsonPath = join(testRoot, 'fred.config.json');
      writeFileSync(tsPath, 'export default {}');
      writeFileSync(jsonPath, '{}');

      const candidates = findCandidateConfigs(testRoot);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].format).toBe('ts');
      expect(candidates[0].path).toBe(tsPath);
      expect(candidates[1].format).toBe('json');
      expect(candidates[1].path).toBe(jsonPath);
    });

    it('ignores directories with config names', () => {
      // Create a directory named fred.config.ts (should be ignored)
      mkdirSync(join(testRoot, 'fred.config.ts'));

      const candidates = findCandidateConfigs(testRoot);
      expect(candidates).toEqual([]);
    });
  });

  describe('detectProjectRoot', () => {
    it('finds config in current directory', () => {
      const configPath = join(testRoot, 'fred.config.ts');
      writeFileSync(configPath, 'export default {}');

      const result = detectProjectRoot(testRoot);
      expect(result.found).toBe(true);
      expect(result.root).toBe(testRoot);
      expect(result.configPath).toBe(configPath);
      expect(result.format).toBe('ts');
      expect(result.checkedPaths.length).toBeGreaterThan(0);
    });

    it('walks upward to find config in parent directory', () => {
      const configPath = join(testRoot, 'fred.config.json');
      writeFileSync(configPath, '{}');

      const subDir = join(testRoot, 'src', 'deep');
      mkdirSync(subDir, { recursive: true });

      const result = detectProjectRoot(subDir);
      expect(result.found).toBe(true);
      expect(result.root).toBe(testRoot);
      expect(result.configPath).toBe(configPath);
      expect(result.format).toBe('json');
    });

    it('prefers nearest config (monorepo package-local wins)', () => {
      // Root workspace config
      const rootConfig = join(testRoot, 'fred.config.json');
      writeFileSync(rootConfig, '{}');

      // Package-local config (should win when starting from inside package)
      const packageDir = join(testRoot, 'packages', 'app');
      mkdirSync(packageDir, { recursive: true });
      const packageConfig = join(packageDir, 'fred.config.ts');
      writeFileSync(packageConfig, 'export default {}');

      const result = detectProjectRoot(packageDir);
      expect(result.found).toBe(true);
      expect(result.root).toBe(packageDir);
      expect(result.configPath).toBe(packageConfig);
      expect(result.format).toBe('ts');
    });

    it('prefers ts over json in same directory', () => {
      const tsPath = join(testRoot, 'fred.config.ts');
      const jsonPath = join(testRoot, 'fred.config.json');
      writeFileSync(tsPath, 'export default {}');
      writeFileSync(jsonPath, '{}');

      const result = detectProjectRoot(testRoot);
      expect(result.found).toBe(true);
      expect(result.configPath).toBe(tsPath);
      expect(result.format).toBe('ts');
    });

    it('returns reason when no config found', () => {
      const result = detectProjectRoot(testRoot);
      expect(result.found).toBe(false);
      expect(result.root).toBeUndefined();
      expect(result.configPath).toBeUndefined();
      expect(result.reason).toBe('reached-fs-root');
      expect(result.checkedPaths.length).toBeGreaterThan(0);
    });

    it('includes all checked paths in result', () => {
      const subDir = join(testRoot, 'src');
      mkdirSync(subDir);

      const result = detectProjectRoot(subDir);
      expect(result.found).toBe(false);

      // Should have checked both ts and json in src/ and parent directories
      const hasCheckedSrcTs = result.checkedPaths.some(p => p.includes('src') && p.endsWith('.ts'));
      const hasCheckedSrcJson = result.checkedPaths.some(p => p.includes('src') && p.endsWith('.json'));
      expect(hasCheckedSrcTs).toBe(true);
      expect(hasCheckedSrcJson).toBe(true);
    });

    it('handles monorepo with nested packages correctly', () => {
      // Workspace root config
      const rootConfig = join(testRoot, 'fred.config.json');
      writeFileSync(rootConfig, '{ "workspace": true }');

      // Package A config
      const pkgADir = join(testRoot, 'packages', 'a');
      mkdirSync(pkgADir, { recursive: true });
      const pkgAConfig = join(pkgADir, 'fred.config.json');
      writeFileSync(pkgAConfig, '{ "package": "a" }');

      // Package B config
      const pkgBDir = join(testRoot, 'packages', 'b');
      mkdirSync(pkgBDir, { recursive: true });
      const pkgBConfig = join(pkgBDir, 'fred.config.ts');
      writeFileSync(pkgBConfig, 'export default { package: "b" }');

      // From package A, should find package A config
      const resultA = detectProjectRoot(pkgADir);
      expect(resultA.found).toBe(true);
      expect(resultA.configPath).toBe(pkgAConfig);

      // From package B, should find package B config
      const resultB = detectProjectRoot(pkgBDir);
      expect(resultB.found).toBe(true);
      expect(resultB.configPath).toBe(pkgBConfig);

      // From packages dir (parent), should find root config
      const packagesDir = join(testRoot, 'packages');
      const resultPackages = detectProjectRoot(packagesDir);
      expect(resultPackages.found).toBe(true);
      expect(resultPackages.configPath).toBe(rootConfig);

      // From root, should find root config
      const resultRoot = detectProjectRoot(testRoot);
      expect(resultRoot.found).toBe(true);
      expect(resultRoot.configPath).toBe(rootConfig);
    });
  });
});
