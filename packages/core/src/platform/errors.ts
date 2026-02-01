/**
 * Effect tagged errors for provider pack system.
 *
 * These errors provide structured error handling with clear remediation hints
 * for pack loading, provider resolution, and runtime failures.
 */

import { Data } from 'effect';

/**
 * Error thrown when a provider pack fails to load.
 *
 * This includes:
 * - Package not installed (missing from node_modules)
 * - Package exports invalid structure (missing/wrong fields)
 * - Package load() function throws during initialization
 */
export class ProviderPackLoadError extends Data.TaggedError('ProviderPackLoadError')<{
  readonly packageName: string;
  readonly reason: string;
  readonly remediation: string;
  readonly cause?: unknown;
}> {
  /**
   * Get error message (for standard Error compatibility).
   */
  get message(): string {
    return `Failed to load provider pack "${this.packageName}": ${this.reason}`;
  }

  /**
   * Format error as a helpful message with remediation steps.
   */
  toString(): string {
    const lines = [
      `ProviderPackLoadError: Failed to load provider pack "${this.packageName}"`,
      ``,
      `Reason: ${this.reason}`,
      ``,
      `How to fix: ${this.remediation}`,
    ];

    if (this.cause) {
      const causeStr = this.cause instanceof Error ? this.cause.message : String(this.cause);
      lines.push(``, `Cause: ${causeStr}`);
    }

    return lines.join('\n');
  }
}

/**
 * Error thrown when a requested provider is not registered.
 *
 * Includes available providers and optional suggestion for typo correction.
 */
export class ProviderNotFoundError extends Data.TaggedError('ProviderNotFoundError')<{
  readonly providerId: string;
  readonly availableProviders: string[];
  readonly suggestion?: string;
}> {
  /**
   * Format error with available options and possible suggestion.
   */
  toString(): string {
    const lines = [
      `ProviderNotFoundError: Provider "${this.providerId}" not found`,
      ``,
      `Available providers: ${this.availableProviders.length > 0 ? this.availableProviders.join(', ') : '(none registered)'}`,
    ];

    if (this.suggestion) {
      lines.push(``, `Did you mean: "${this.suggestion}"?`);
    }

    return lines.join('\n');
  }
}

/**
 * Error thrown during provider operation execution.
 *
 * Wraps underlying errors from provider SDK calls (getModel, generateText, etc.)
 * with context about which provider/model failed.
 */
export class ProviderRuntimeError extends Data.TaggedError('ProviderRuntimeError')<{
  readonly providerId: string;
  readonly modelId?: string;
  readonly operation: string;
  readonly cause: unknown;
}> {
  /**
   * Format error with provider context and underlying cause.
   */
  toString(): string {
    const target = this.modelId ? `${this.providerId}/${this.modelId}` : this.providerId;
    const causeStr = this.cause instanceof Error ? this.cause.message : String(this.cause);

    return [
      `ProviderRuntimeError: Operation "${this.operation}" failed for ${target}`,
      ``,
      `Cause: ${causeStr}`,
    ].join('\n');
  }
}

/**
 * Error thrown when provider registration fails.
 */
export class ProviderRegistrationError extends Data.TaggedError('ProviderRegistrationError')<{
  readonly providerId: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when a provider model operation fails.
 */
export class ProviderModelError extends Data.TaggedError('ProviderModelError')<{
  readonly providerId: string;
  readonly modelId: string;
  readonly cause: unknown;
}> {}

/**
 * Union type for all provider errors, enabling exhaustive catchTag handling.
 */
export type ProviderError =
  | ProviderPackLoadError
  | ProviderNotFoundError
  | ProviderRuntimeError
  | ProviderRegistrationError
  | ProviderModelError;
