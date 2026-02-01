import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, isAbsolute, relative, normalize } from 'path';

/**
 * Check if a string looks like a file path
 */
export function isFilePath(value: string): boolean {
  // Check if it starts with ./ or ../ or / or ~
  if (/^\.\.?\/|^\/|^~/.test(value)) {
    return true;
  }
  // Check if it ends with .md or .markdown
  if (/\.(md|markdown)$/i.test(value)) {
    return true;
  }
  return false;
}

/**
 * Validate that a resolved path is within the sandbox directory
 * Prevents path traversal attacks
 */
function isPathWithinSandbox(filePath: string, sandboxDir: string): boolean {
  const normalizedFilePath = normalize(resolve(filePath));
  const normalizedSandbox = normalize(resolve(sandboxDir));
  
  // Get relative path from sandbox to file
  const relativePath = relative(normalizedSandbox, normalizedFilePath);
  
  // If relative path is empty or '.', the file is at the sandbox root (allowed)
  // If relative path starts with '..', it's outside the sandbox (blocked)
  // If relative path is absolute, it's outside the sandbox (blocked)
  // Otherwise, it's a valid relative path within the sandbox (allowed)
  if (!relativePath || relativePath === '.' || relativePath === './') {
    return true; // File is at sandbox root
  }
  
  // Check if path escapes the sandbox
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return false;
  }
  
  // Path is within sandbox
  return true;
}

/**
 * Load a prompt file if it's a file path, otherwise return the string as-is
 * @param systemMessage - Either a file path or literal string content
 * @param basePath - Base path to resolve relative paths against (usually config file directory)
 * @param allowAbsolutePaths - Whether to allow absolute paths (default: false for security)
 * @returns The loaded markdown content or the original string
 */
export function loadPromptFile(
  systemMessage: string,
  basePath?: string,
  allowAbsolutePaths: boolean = false
): string {
  // If it doesn't look like a file path, return as-is
  if (!isFilePath(systemMessage)) {
    return systemMessage;
  }

  // Determine sandbox directory
  const sandboxDir = basePath ? dirname(basePath) : process.cwd();

  // Resolve the file path
  let filePath: string;
  if (isAbsolute(systemMessage)) {
    // Reject absolute paths unless explicitly allowed
    if (!allowAbsolutePaths) {
      throw new Error(`Absolute paths are not allowed for security reasons. Use a relative path instead. Attempted path: ${systemMessage}`);
    }
    filePath = normalize(systemMessage);
  } else if (basePath) {
    // Resolve relative to base path (config file directory)
    filePath = resolve(sandboxDir, systemMessage);
  } else {
    // Resolve relative to current working directory
    filePath = resolve(process.cwd(), systemMessage);
  }

  // Normalize the path to resolve any .. sequences
  filePath = normalize(filePath);

  // Validate that the resolved path is within the sandbox directory
  // This prevents path traversal attacks like ../../../../etc/passwd
  if (!isPathWithinSandbox(filePath, sandboxDir)) {
    throw new Error(`Path traversal detected. File path "${systemMessage}" resolves outside the allowed directory "${sandboxDir}"`);
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    // If file doesn't exist, treat it as literal string content
    // This provides backward compatibility and graceful degradation
    return systemMessage;
  }

  try {
    // Read and return the file content
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    // If there's an error reading the file, fall back to treating it as a string
    console.warn(`Warning: Could not load prompt file "${filePath}": ${error instanceof Error ? error.message : error}. Using as literal string.`);
    return systemMessage;
  }
}
