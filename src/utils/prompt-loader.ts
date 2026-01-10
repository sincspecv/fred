import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';

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
 * Load a prompt file if it's a file path, otherwise return the string as-is
 * @param systemMessage - Either a file path or literal string content
 * @param basePath - Base path to resolve relative paths against (usually config file directory)
 * @returns The loaded markdown content or the original string
 */
export function loadPromptFile(
  systemMessage: string,
  basePath?: string
): string {
  // If it doesn't look like a file path, return as-is
  if (!isFilePath(systemMessage)) {
    return systemMessage;
  }

  // Resolve the file path
  let filePath: string;
  if (isAbsolute(systemMessage)) {
    filePath = systemMessage;
  } else if (basePath) {
    // Resolve relative to base path (config file directory)
    filePath = resolve(dirname(basePath), systemMessage);
  } else {
    // Resolve relative to current working directory
    filePath = resolve(process.cwd(), systemMessage);
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
