/**
 * Redaction and error taxonomy tests
 *
 * Verifies that error classification, redaction, and verbosity gating
 * work as expected for observability safety.
 */

import { describe, test, expect } from 'bun:test';
import {
  ErrorClass,
  classifyError,
  errorClassToSpanStatus,
  errorClassToLogLevel,
  redact,
  defaultRedactionFilter,
  type RedactionContext,
} from '../../../../packages/core/src/observability/errors';
import {
  shouldLogEvent,
  getEffectiveLogLevel,
  type VerbosityOverrides,
} from '../../../../packages/core/src/observability/otel';
import { LogLevel } from 'effect';

describe('Error Classification', () => {
  test('should classify timeout errors as RETRYABLE', () => {
    const error = new Error('Request timeout after 30s');
    expect(classifyError(error)).toBe(ErrorClass.RETRYABLE);
  });

  test('should classify rate limit errors as RETRYABLE', () => {
    const error = new Error('Rate limit exceeded: 429');
    expect(classifyError(error)).toBe(ErrorClass.RETRYABLE);
  });

  test('should classify validation errors as USER', () => {
    const error = new Error('Validation failed: invalid input');
    expect(classifyError(error)).toBe(ErrorClass.USER);
  });

  test('should classify 400 errors as USER', () => {
    const error = new Error('Bad request: 400');
    expect(classifyError(error)).toBe(ErrorClass.USER);
  });

  test('should classify API key errors as PROVIDER', () => {
    const error = new Error('Invalid API key');
    expect(classifyError(error)).toBe(ErrorClass.PROVIDER);
  });

  test('should classify quota errors as PROVIDER', () => {
    const error = new Error('Quota exceeded for model');
    expect(classifyError(error)).toBe(ErrorClass.PROVIDER);
  });

  test('should classify database errors as INFRASTRUCTURE', () => {
    const error = new Error('Database connection failed');
    expect(classifyError(error)).toBe(ErrorClass.INFRASTRUCTURE);
  });

  test('should classify connection errors as INFRASTRUCTURE', () => {
    const error = new Error('ECONNREFUSED: connection refused');
    expect(classifyError(error)).toBe(ErrorClass.INFRASTRUCTURE);
  });

  test('should classify unknown errors as UNKNOWN', () => {
    const error = new Error('Something unexpected happened');
    expect(classifyError(error)).toBe(ErrorClass.UNKNOWN);
  });
});

describe('Error to Span Status Mapping', () => {
  test('should map USER errors to ok status', () => {
    expect(errorClassToSpanStatus(ErrorClass.USER)).toBe('ok');
  });

  test('should map RETRYABLE errors to error status', () => {
    expect(errorClassToSpanStatus(ErrorClass.RETRYABLE)).toBe('error');
  });

  test('should map PROVIDER errors to error status', () => {
    expect(errorClassToSpanStatus(ErrorClass.PROVIDER)).toBe('error');
  });

  test('should map INFRASTRUCTURE errors to error status', () => {
    expect(errorClassToSpanStatus(ErrorClass.INFRASTRUCTURE)).toBe('error');
  });

  test('should map UNKNOWN errors to error status', () => {
    expect(errorClassToSpanStatus(ErrorClass.UNKNOWN)).toBe('error');
  });
});

describe('Error to Log Level Mapping', () => {
  test('should map USER errors to Warning level', () => {
    expect(errorClassToLogLevel(ErrorClass.USER)).toBe(LogLevel.Warning);
  });

  test('should map RETRYABLE errors to Warning level', () => {
    expect(errorClassToLogLevel(ErrorClass.RETRYABLE)).toBe(LogLevel.Warning);
  });

  test('should map PROVIDER errors to Error level', () => {
    expect(errorClassToLogLevel(ErrorClass.PROVIDER)).toBe(LogLevel.Error);
  });

  test('should map INFRASTRUCTURE errors to Error level', () => {
    expect(errorClassToLogLevel(ErrorClass.INFRASTRUCTURE)).toBe(LogLevel.Error);
  });

  test('should map UNKNOWN errors to Error level', () => {
    expect(errorClassToLogLevel(ErrorClass.UNKNOWN)).toBe(LogLevel.Error);
  });
});

describe('Default Redaction Filter', () => {
  test('should allow all payloads at debug level', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool',
      logLevel: LogLevel.Debug,
    };

    const payload = { apiKey: 'secret', data: 'sensitive' };
    const result = defaultRedactionFilter(payload, context);

    expect(result).toEqual(payload);
  });

  test('should allow all payloads at trace level', () => {
    const context: RedactionContext = {
      payloadType: 'response',
      source: 'provider',
      logLevel: LogLevel.Trace,
    };

    const payload = { token: 'secret', content: 'private' };
    const result = defaultRedactionFilter(payload, context);

    expect(result).toEqual(payload);
  });

  test('should redact request payloads at info level', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool',
      logLevel: LogLevel.Info,
    };

    const payload = { apiKey: 'secret', data: 'sensitive' };
    const result = defaultRedactionFilter(payload, context);

    expect(result).toBe('[REDACTED]');
  });

  test('should redact response payloads at info level', () => {
    const context: RedactionContext = {
      payloadType: 'response',
      source: 'provider',
      logLevel: LogLevel.Info,
    };

    const payload = { token: 'secret', content: 'private' };
    const result = defaultRedactionFilter(payload, context);

    expect(result).toBe('[REDACTED]');
  });

  test('should allow error message but strip stack at info level', () => {
    const context: RedactionContext = {
      payloadType: 'error',
      source: 'step',
      logLevel: LogLevel.Info,
    };

    const payload = {
      message: 'Something failed',
      name: 'Error',
      stack: 'Error: Something failed\n    at ...',
    };

    const result = defaultRedactionFilter(payload, context) as any;

    expect(result.message).toBe('Something failed');
    expect(result.name).toBe('Error');
    expect(result.stack).toBeUndefined();
  });

  test('should allow metadata payloads through', () => {
    const context: RedactionContext = {
      payloadType: 'metadata',
      source: 'step',
      logLevel: LogLevel.Info,
    };

    const payload = { runId: 'run-123', stepName: 'validate' };
    const result = defaultRedactionFilter(payload, context);

    expect(result).toEqual(payload);
  });
});

describe('Redaction with Custom Filters', () => {
  test('should use custom filter when provided', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool',
      logLevel: LogLevel.Info,
    };

    const customFilter = (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null) {
        const obj = payload as any;
        return { ...obj, apiKey: '[MASKED]' };
      }
      return payload;
    };

    const payload = { apiKey: 'secret', data: 'visible' };
    const result = redact(payload, context, customFilter) as any;

    expect(result.apiKey).toBe('[MASKED]');
    expect(result.data).toBe('visible');
  });

  test('should handle filter errors gracefully', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool',
      logLevel: LogLevel.Info,
    };

    const faultyFilter = () => {
      throw new Error('Filter error');
    };

    const payload = { apiKey: 'secret' };
    const result = redact(payload, context, faultyFilter);

    expect(result).toBe('[REDACTION_ERROR]');
  });
});

describe('Verbosity Override Handling', () => {
  test('should gate token streams by default', () => {
    const verbosity: VerbosityOverrides = {};

    // Token events only log at debug
    expect(shouldLogEvent('token', LogLevel.Debug, verbosity)).toBe(true);
    expect(shouldLogEvent('token', LogLevel.Info, verbosity)).toBe(false);
  });

  test('should gate heartbeats by default', () => {
    const verbosity: VerbosityOverrides = {};

    // Heartbeat events only log at debug
    expect(shouldLogEvent('heartbeat', LogLevel.Debug, verbosity)).toBe(true);
    expect(shouldLogEvent('heartbeat', LogLevel.Info, verbosity)).toBe(false);
  });

  test('should always log summary events', () => {
    const verbosity: VerbosityOverrides = {};

    // Summary events always log
    expect(shouldLogEvent('summary', LogLevel.Debug, verbosity)).toBe(true);
    expect(shouldLogEvent('summary', LogLevel.Info, verbosity)).toBe(true);
    expect(shouldLogEvent('summary', LogLevel.Warning, verbosity)).toBe(true);
  });

  test('should respect verbosity override for tokens', () => {
    const verbosity: VerbosityOverrides = {
      gateTokenStreams: false,
      highVolumeLevel: 'info',
    };

    // Token events log at info when not gated
    expect(shouldLogEvent('token', LogLevel.Info, verbosity)).toBe(true);
  });

  test('should respect verbosity override for heartbeats', () => {
    const verbosity: VerbosityOverrides = {
      gateHeartbeats: false,
      highVolumeLevel: 'info',
    };

    // Heartbeat events log at info when not gated
    expect(shouldLogEvent('heartbeat', LogLevel.Info, verbosity)).toBe(true);
  });

  test('should gate high-volume events at info when highVolumeLevel is debug', () => {
    const verbosity: VerbosityOverrides = {
      gateTokenStreams: false,
      gateHeartbeats: false,
      highVolumeLevel: 'debug',
    };

    // When highVolumeLevel is debug, high-volume events only log at debug/trace
    expect(shouldLogEvent('token', LogLevel.Debug, verbosity)).toBe(true);
    expect(shouldLogEvent('token', LogLevel.Info, verbosity)).toBe(false);
  });
});

describe('Effective Log Level Resolution', () => {
  test('should use debug in development by default', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const level = getEffectiveLogLevel({});
    expect(level).toBe(LogLevel.Debug);

    process.env.NODE_ENV = originalEnv;
  });

  test('should use info in production by default', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const level = getEffectiveLogLevel({});
    expect(level).toBe(LogLevel.Info);

    process.env.NODE_ENV = originalEnv;
  });

  test('should use config log level when provided', () => {
    const level = getEffectiveLogLevel({ logLevel: 'warning' });
    expect(level).toBe(LogLevel.Warning);
  });

  test('should prefer environment variable over config', () => {
    const originalEnv = process.env.FRED_LOG_LEVEL;
    process.env.FRED_LOG_LEVEL = 'error';

    const level = getEffectiveLogLevel({ logLevel: 'debug' });
    expect(level).toBe(LogLevel.Error);

    if (originalEnv) {
      process.env.FRED_LOG_LEVEL = originalEnv;
    } else {
      delete process.env.FRED_LOG_LEVEL;
    }
  });
});

describe('Documentation Examples Validation', () => {
  test('should match documented redaction behavior for sensitive fields', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool:search',
      logLevel: LogLevel.Info,
    };

    // Example from docs: custom redaction filter
    const customFilter: RedactionFilter = (payload, ctx) => {
      if (ctx.logLevel === LogLevel.Debug || ctx.logLevel === LogLevel.Trace) {
        return payload;
      }

      if (typeof payload === 'object' && payload !== null) {
        const obj = payload as any;
        const redacted = { ...obj };
        const sensitiveFields = ['apiKey', 'password', 'token', 'secret', 'credential'];
        for (const field of sensitiveFields) {
          if (field in redacted) {
            redacted[field] = '[MASKED]';
          }
        }
        return redacted;
      }

      return '[REDACTED]';
    };

    const payload = {
      apiKey: 'sk-secret123',
      password: 'mypassword',
      query: 'search term',
    };

    const result = redact(payload, context, customFilter) as any;

    expect(result.apiKey).toBe('[MASKED]');
    expect(result.password).toBe('[MASKED]');
    expect(result.query).toBe('search term');
  });

  test('should match documented behavior for debug mode showing everything', () => {
    const context: RedactionContext = {
      payloadType: 'request',
      source: 'tool:search',
      logLevel: LogLevel.Debug,
    };

    const customFilter: RedactionFilter = (payload, ctx) => {
      if (ctx.logLevel === LogLevel.Debug || ctx.logLevel === LogLevel.Trace) {
        return payload; // Show everything at debug
      }
      return '[REDACTED]';
    };

    const payload = {
      apiKey: 'sk-secret123',
      data: 'sensitive',
    };

    const result = redact(payload, context, customFilter);

    expect(result).toEqual(payload); // Unchanged at debug level
  });

  test('should match documented verbosity override behavior', () => {
    // Default behavior: gate tokens and heartbeats
    expect(shouldLogEvent('token', LogLevel.Info, { gateTokenStreams: true })).toBe(false);
    expect(shouldLogEvent('token', LogLevel.Debug, { gateTokenStreams: true })).toBe(true);

    // Override to allow at info level
    expect(shouldLogEvent('token', LogLevel.Info, {
      gateTokenStreams: false,
      highVolumeLevel: 'info',
    })).toBe(true);

    // Summary events always log
    expect(shouldLogEvent('summary', LogLevel.Info, {})).toBe(true);
    expect(shouldLogEvent('summary', LogLevel.Warning, {})).toBe(true);
  });
});
