/**
 * Project detection and config resolution types
 */

/**
 * Reason code for no config found
 */
export type NoConfigReason =
  | 'no-config-file'
  | 'reached-fs-root'
  | 'permission-denied';

/**
 * Config file format
 */
export type ConfigFormat = 'ts' | 'json';

/**
 * Candidate config file
 */
export interface ConfigCandidate {
  /** Absolute path to config file */
  path: string;
  /** Config format (ts or json) */
  format: ConfigFormat;
  /** Directory containing the config */
  directory: string;
}

/**
 * Result of project detection
 */
export interface ProjectDetectionResult {
  /** True if a config was found */
  found: boolean;
  /** Project root directory (where config was found) */
  root?: string;
  /** Chosen config path */
  configPath?: string;
  /** Config format */
  format?: ConfigFormat;
  /** All checked paths during traversal */
  checkedPaths: string[];
  /** Reason if no config found */
  reason?: NoConfigReason;
}

/**
 * Diagnostic severity level
 */
export type DiagnosticSeverity = 'error' | 'warning';

/**
 * Structured diagnostic for config validation
 */
export interface ConfigDiagnostic {
  /** Stable machine-readable identifier */
  code: string;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Single-line direct error message */
  message: string;
  /** File path where issue occurred */
  path?: string;
  /** Line number (if available) */
  line?: number;
  /** Column number (if available) */
  column?: number;
  /** Concrete next-step command or edit hint */
  fix?: string;
}

/**
 * Result of config resolution
 */
export interface ConfigResolutionResult<T = any> {
  /** True if config was successfully resolved and validated */
  success: boolean;
  /** Validated config data (if successful) */
  config?: T;
  /** Path to the loaded config */
  configPath?: string;
  /** Diagnostics (errors or warnings) */
  diagnostics: ConfigDiagnostic[];
}
