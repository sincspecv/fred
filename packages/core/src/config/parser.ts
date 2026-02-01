import { readFileSync } from 'fs';
import { extname } from 'path';
import yaml from 'js-yaml';
import { FrameworkConfig, ConfigFormat } from './types';

/**
 * Parse a config file (JSON or YAML)
 */
export function parseConfigFile(filePath: string): FrameworkConfig {
  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, 'utf-8');

  if (ext === '.json' || ext === '.jsonc') {
    return JSON.parse(content) as FrameworkConfig;
  } else if (ext === '.yaml' || ext === '.yml') {
    return yaml.load(content) as FrameworkConfig;
  } else {
    throw new Error(`Unsupported config file format: ${ext}. Use .json, .yaml, or .yml`);
  }
}

/**
 * Parse config from string content
 */
export function parseConfig(content: string, format: ConfigFormat = 'json'): FrameworkConfig {
  if (format === 'json') {
    return JSON.parse(content) as FrameworkConfig;
  } else if (format === 'yaml' || format === 'yml') {
    return yaml.load(content) as FrameworkConfig;
  } else {
    throw new Error(`Unsupported config format: ${format}`);
  }
}

/**
 * Detect config format from file extension
 */
export function detectConfigFormat(filePath: string): ConfigFormat {
  const ext = extname(filePath).toLowerCase();
  
  if (ext === '.json' || ext === '.jsonc') {
    return 'json';
  } else if (ext === '.yaml' || ext === '.yml') {
    return 'yaml';
  } else {
    throw new Error(`Cannot detect config format from extension: ${ext}`);
  }
}

