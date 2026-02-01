/**
 * Security validation utilities
 */

/**
 * Maximum length for IDs to prevent DoS
 */
const MAX_ID_LENGTH = 256;

/**
 * Maximum number of agents allowed in a pipeline
 */
const MAX_PIPELINE_AGENTS = 100;

/**
 * Maximum message length to prevent resource exhaustion
 */
const MAX_MESSAGE_LENGTH = 1_000_000; // 1MB

/**
 * Maximum accumulated messages in pipeline
 */
const MAX_PIPELINE_MESSAGES = 1000;

/**
 * Validate ID format - alphanumeric, hyphens, underscores only
 * Prevents injection attacks and ensures safe usage in maps/keys
 */
export function validateId(id: string, entityType: string = 'ID'): void {
  if (!id || typeof id !== 'string') {
    throw new Error(`${entityType} must be a non-empty string`);
  }

  if (id.length > MAX_ID_LENGTH) {
    throw new Error(`${entityType} exceeds maximum length of ${MAX_ID_LENGTH} characters`);
  }

  // Allow alphanumeric, hyphens, underscores, and dots (for namespacing)
  // This prevents injection attacks while allowing reasonable flexibility
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(`${entityType} contains invalid characters. Only alphanumeric, dots, hyphens, and underscores are allowed`);
  }
}

/**
 * Validate message content length
 */
export function validateMessageLength(message: string): void {
  if (typeof message !== 'string') {
    throw new Error('Message must be a string');
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
  }
}

/**
 * Validate pipeline agent count
 */
export function validatePipelineAgentCount(count: number): void {
  if (count > MAX_PIPELINE_AGENTS) {
    throw new Error(`Pipeline exceeds maximum agent count of ${MAX_PIPELINE_AGENTS}`);
  }

  if (count === 0) {
    throw new Error('Pipeline must have at least one agent');
  }
}

/**
 * Validate accumulated message count in pipeline
 */
export function validatePipelineMessageCount(count: number): void {
  if (count > MAX_PIPELINE_MESSAGES) {
    throw new Error(`Pipeline message accumulation exceeds maximum of ${MAX_PIPELINE_MESSAGES} messages`);
  }
}

/**
 * Validate regex pattern to prevent ReDoS attacks
 * Checks for potentially dangerous patterns that could cause catastrophic backtracking
 */
export function validateRegexPattern(pattern: string): boolean {
  if (typeof pattern !== 'string') {
    return false;
  }

  // Limit pattern length to prevent ReDoS
  if (pattern.length > 1000) {
    return false;
  }

  // Check for dangerous patterns that could cause catastrophic backtracking
  // Patterns with nested quantifiers like (a+)+ or (a*)* are dangerous
  const dangerousPatterns = [
    /\([^)]*\+\)\+/,  // Nested + quantifiers
    /\([^)]*\*\)\*/,  // Nested * quantifiers
    /\([^)]*\?\)\?/,  // Nested ? quantifiers
    /\([^)]*\{[^}]*\}\)\{[^}]*\}/, // Nested {} quantifiers
  ];

  for (const dangerousPattern of dangerousPatterns) {
    if (dangerousPattern.test(pattern)) {
      return false;
    }
  }

  // Try to compile the regex to ensure it's valid
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize error messages to prevent information leakage
 */
export function sanitizeError(error: unknown, context?: string): Error {
  if (error instanceof Error) {
    // Don't expose internal paths or sensitive information
    let message = error.message;
    
    // Remove absolute paths
    message = message.replace(/\/[^\s]+/g, '[path]');
    
    // Remove potential sensitive data patterns
    message = message.replace(/api[_-]?key[=:]\s*[^\s]+/gi, 'api[_-]?key=[redacted]');
    message = message.replace(/token[=:]\s*[^\s]+/gi, 'token=[redacted]');
    
    return new Error(context ? `${context}: ${message}` : message);
  }
  
  return new Error(context ? `${context}: Unknown error` : 'Unknown error');
}
