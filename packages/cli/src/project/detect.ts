/**
 * Project root and config detection
 *
 * Implements nearest-config-wins by walking upward from cwd to filesystem root,
 * checking each directory for fred.config.ts (preferred) or fred.config.json.
 */

import { existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { ConfigCandidate, ProjectDetectionResult } from './types';

/**
 * Config file names in order of precedence
 */
const CONFIG_FILENAMES = [
  { name: 'fred.config.ts', format: 'ts' as const },
  { name: 'fred.config.json', format: 'json' as const },
];

/**
 * Find candidate config files in a directory
 *
 * @param dir - Directory to check
 * @returns Array of candidate configs in precedence order (ts before json)
 */
export function findCandidateConfigs(dir: string): ConfigCandidate[] {
  const candidates: ConfigCandidate[] = [];

  for (const { name, format } of CONFIG_FILENAMES) {
    const candidatePath = join(dir, name);

    try {
      if (existsSync(candidatePath)) {
        const stat = statSync(candidatePath);
        if (stat.isFile()) {
          candidates.push({
            path: candidatePath,
            format,
            directory: dir,
          });
        }
      }
    } catch (error) {
      // Permission denied or other FS error - skip this candidate
      continue;
    }
  }

  return candidates;
}

/**
 * Check if we've reached the filesystem root
 *
 * @param dir - Directory to check
 * @returns True if at filesystem root
 */
function isFilesystemRoot(dir: string): boolean {
  const parent = dirname(dir);
  return parent === dir;
}

/**
 * Detect project root and config file
 *
 * Walks upward from startDir (defaults to cwd) to filesystem root,
 * checking each directory for config files. Returns the nearest config found.
 *
 * Precedence rules:
 * - Nearest directory wins (closer to startDir)
 * - Within a directory: fred.config.ts > fred.config.json
 *
 * Supports monorepo workspaces: package-local config takes precedence over
 * workspace root config when both exist.
 *
 * @param startDir - Directory to start search from (defaults to process.cwd())
 * @returns Detection result with found config or reason for failure
 */
export function detectProjectRoot(startDir?: string): ProjectDetectionResult {
  const start = resolve(startDir ?? process.cwd());
  let currentDir = start;
  const checkedPaths: string[] = [];

  while (true) {
    // Find candidates in current directory
    const candidates = findCandidateConfigs(currentDir);

    // Record all checked paths
    for (const { name } of CONFIG_FILENAMES) {
      checkedPaths.push(join(currentDir, name));
    }

    // If we found candidates, return the first one (highest precedence)
    if (candidates.length > 0) {
      const chosen = candidates[0];
      return {
        found: true,
        root: currentDir,
        configPath: chosen.path,
        format: chosen.format,
        checkedPaths,
      };
    }

    // Check if we've reached filesystem root
    if (isFilesystemRoot(currentDir)) {
      return {
        found: false,
        checkedPaths,
        reason: 'reached-fs-root',
      };
    }

    // Move to parent directory
    currentDir = dirname(currentDir);
  }
}
