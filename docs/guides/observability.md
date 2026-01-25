# Observability Guide

Fred provides comprehensive observability through OpenTelemetry-compatible tracing and logging using Effect's built-in capabilities. This guide covers configuration, safeguards, and best practices for monitoring your agent workflows.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Error Classification](#error-classification)
4. [Redaction and Security](#redaction-and-security)
5. [Verbosity Controls](#verbosity-controls)
6. [Span Structure](#span-structure)
7. [Pause/Resume Tracing](#pauseresume-tracing)
8. [Best Practices](#best-practices)

## Overview

Fred's observability layer provides:

- **Distributed tracing** with OpenTelemetry spans for pipelines, steps, tools, and providers
- **Structured logging** with Effect's logging system
- **Error classification** (retryable, user, provider, infrastructure)
- **Payload redaction** to prevent sensitive data leakage
- **Verbosity overrides** to control high-volume event logging

All spans and logs include essential identifiers:
- `runId` - Unique identifier for each pipeline execution
- `conversationId` - Conversation/thread identifier
- `workflowId` - Workflow/pipeline identifier
- `stepName` - Current step name
- `attempt` - Retry attempt number

## Configuration

### Basic Setup

Configure observability in your Fred config:

```typescript
import { Fred } from '@fred/core';

const fred = new Fred({
  observability: {
    // OTLP exporter endpoint (optional)
    otlp: {
      endpoint: 'http://localhost:4318/v1/traces',
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN', // Optional auth
      },
    },

    // Log level (defaults to debug in dev, info in prod)
    logLevel: 'debug', // 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'

    // Resource attributes attached to all spans/logs
    resource: {
      serviceName: 'my-fred-app',
      serviceVersion: '1.0.0',
      environment: 'production',
    },

    // Console fallback when OTLP not configured (default: true in dev)
    enableConsoleFallback: true,

    // Verbosity overrides for high-volume events
    verbosity: {
      gateTokenStreams: true,   // Gate token events to debug level (default: true)
      gateHeartbeats: true,      // Gate heartbeat events to debug level (default: true)
      highVolumeLevel: 'debug',  // Level for high-volume events when not gated
    },
  },
});
```

### Environment Variables

Environment variables override config values:

```bash
# Log level override
export FRED_LOG_LEVEL=debug

# OTLP endpoint (if using external config)
export FRED_OTEL_ENDPOINT=http://localhost:4318/v1/traces

# Environment
export NODE_ENV=production
```

### Per-Run Verbosity Overrides

You can override log level for specific pipeline runs:

```typescript
const result = await fred.processMessage('user message', {
  observability: {
    logLevel: 'trace', // Override for this run only
    verbosity: {
      gateTokenStreams: false, // Allow token streams at info level
    },
  },
});
```

## Error Classification

Fred automatically classifies errors into categories that determine logging behavior:

### Error Classes

| Class | Description | Span Status | Log Level |
|-------|-------------|-------------|-----------|
| `RETRYABLE` | Transient errors (timeouts, rate limits) | error | warning |
| `USER` | User input errors (validation failures) | ok | warning |
| `PROVIDER` | Provider/model errors (API errors, quota) | error | error |
| `INFRASTRUCTURE` | Infrastructure errors (database, network) | error | error |
| `UNKNOWN` | Unclassified errors | error | error |

### Classification Logic

Errors are classified based on message content:

```typescript
import { classifyError, ErrorClass } from '@fred/core/observability/errors';

const error = new Error('Rate limit exceeded: 429');
const errorClass = classifyError(error); // ErrorClass.RETRYABLE

// Errors update span status automatically
// User errors (validation) don't mark spans as failed (span status: ok)
// System errors (provider, infrastructure) mark spans as failed (span status: error)
```

### Custom Error Metadata

Attach metadata to spans for errors:

```typescript
import { attachErrorToSpan } from '@fred/core/observability/errors';

const span = tracer.startSpan('my-operation');
try {
  // ... operation
} catch (error) {
  attachErrorToSpan(span, error as Error, {
    errorClass: ErrorClass.PROVIDER,
    includeStack: false, // Stack only in debug mode
    metadata: {
      providerId: 'openai',
      modelId: 'gpt-4',
    },
  });
  throw error;
} finally {
  span.end();
}
```

## Redaction and Security

Fred provides payload redaction to prevent sensitive data from appearing in traces and logs.

### Default Redaction Behavior

By default, Fred redacts request/response payloads at info level and above:

```typescript
// At debug/trace level: full payloads visible
// At info/warning/error level: request/response redacted to '[REDACTED]'

// Errors always include message, but stack only at debug level
```

### Custom Redaction Filter

Provide a custom filter for fine-grained control:

```typescript
import { type RedactionFilter } from '@fred/core/observability/errors';

const customRedactionFilter: RedactionFilter = (payload, context) => {
  // Context provides: payloadType, source, logLevel, errorClass

  if (context.payloadType === 'request') {
    // Mask API keys but keep other fields
    if (typeof payload === 'object' && payload !== null) {
      const obj = payload as any;
      return {
        ...obj,
        apiKey: obj.apiKey ? '[MASKED]' : undefined,
        password: obj.password ? '[MASKED]' : undefined,
      };
    }
  }

  // Allow other payloads through
  return payload;
};

// Apply to tool registry
toolRegistry.setRedactionFilter(customRedactionFilter);

// Or use directly
import { redact } from '@fred/core/observability/errors';

const safePayload = redact(payload, {
  payloadType: 'request',
  source: 'tool:search',
  logLevel: LogLevel.Info,
}, customRedactionFilter);
```

### Redaction Context

The redaction context provides information for filtering decisions:

```typescript
interface RedactionContext {
  payloadType: 'request' | 'response' | 'error' | 'metadata';
  source: string;              // e.g., 'tool:search', 'provider:openai'
  logLevel: LogLevel.LogLevel; // Current log level
  errorClass?: ErrorClass;     // Error classification (if applicable)
}
```

## Verbosity Controls

Control which events are logged to manage volume and cost.

### Event Types

| Event Type | Default Behavior | Can Override |
|------------|------------------|--------------|
| Token streams | Debug only | Yes |
| Heartbeats | Debug only | Yes |
| Summary events | Always logged | No |
| Tool calls | Always logged | No |
| Errors | Always logged | No |

### Gating High-Volume Events

```typescript
import { shouldLogEvent } from '@fred/core/observability/otel';

// Check if event should be logged
const shouldLog = shouldLogEvent(
  'token',           // Event type
  LogLevel.Info,     // Current log level
  {
    gateTokenStreams: true, // Only log at debug
  }
);

if (shouldLog) {
  // Log the event
}
```

### Per-Run Overrides

```typescript
const result = await pipelineManager.execute('pipeline-id', 'input', {
  observability: {
    verbosity: {
      gateTokenStreams: false,  // Allow tokens at info level for this run
      gateHeartbeats: true,      // Keep heartbeats gated
      highVolumeLevel: 'info',   // When not gated, log at info
    },
  },
});
```

## Span Structure

Fred creates a hierarchical span structure for complete traces:

### Pipeline Execution

```
pipeline.execute.{pipelineId}
  ├─ pipeline.step.{stepName}
  │   ├─ tool.execute (if step calls tool)
  │   └─ model.call (if step uses agent)
  ├─ pipeline.step.{stepName}
  └─ ...
```

### Tool Execution

```
tool.execute
  Attributes:
    - tool.id
    - tool.timeout
    - tool.executionTime
    - agentId
```

### Model Calls

```
model.call
  Attributes:
    - agent.id
    - model.name
    - model.platform
    - model.temperature
    - model.maxTokens
    - response.finishReason
    - toolCalls.count
```

### Graph Workflows

```
graph.execute.{graphId}
  ├─ graph.node.{nodeId}
  ├─ graph.fork (event)
  ├─ graph.join (event)
  └─ graph.branch_decision (event)
```

### Retry Annotations

Retries are annotated on the step span:

```
pipeline.step.{stepName}
  Events:
    - retry.attempt.1 (attempt: 1, maxRetries: 3)
    - retry.error (attempt: 1, error.message: "...")
    - retry.attempt.2 (attempt: 2, maxRetries: 3)
    - retry.success (attempt: 2)
```

## Pause/Resume Tracing

Pause and resume operations create dedicated spans:

### Checkpoint Creation

```
checkpoint.save
  Attributes:
    - runId
    - pipelineId
    - step
    - stepName
    - status (in_progress | paused)
    - storage.type (postgres | sqlite)
```

### Pause Detection

```
pipeline.pause
  Attributes:
    - runId
    - pauseId (equals runId)
    - stepName
    - prompt
    - choices (if multiple choice)
```

### Resume Execution

```
pipeline.resume
  Attributes:
    - runId
    - pauseId
    - stepName
    - resumeBehavior (continue | restart | custom)
```

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// Development: debug for all details
export FRED_LOG_LEVEL=debug

// Production: info for summaries only
export FRED_LOG_LEVEL=info

// Troubleshooting: trace for maximum detail
export FRED_LOG_LEVEL=trace
```

### 2. Configure OTLP Endpoint

Send traces to your observability backend:

```typescript
observability: {
  otlp: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: {
      'Authorization': `Bearer ${process.env.OTEL_AUTH_TOKEN}`,
    },
  },
}
```

### 3. Apply Redaction Filters

Prevent sensitive data leakage:

```typescript
// Set custom redaction on tool registry
toolRegistry.setRedactionFilter((payload, context) => {
  if (context.logLevel !== LogLevel.Debug) {
    // Redact all payloads unless debug mode
    return '[REDACTED]';
  }
  return payload;
});
```

### 4. Monitor High-Volume Events

Gate token streams in production:

```typescript
observability: {
  verbosity: {
    gateTokenStreams: true,  // Tokens only at debug
    gateHeartbeats: true,     // Heartbeats only at debug
  },
}
```

### 5. Use Resource Attributes

Add context to all traces:

```typescript
observability: {
  resource: {
    serviceName: 'customer-support-bot',
    serviceVersion: process.env.APP_VERSION,
    environment: process.env.NODE_ENV,
    region: process.env.AWS_REGION,
    instanceId: process.env.INSTANCE_ID,
  },
}
```

### 6. Handle Errors Properly

Let Fred classify errors automatically:

```typescript
// Fred automatically classifies and logs errors
// No manual error handling needed - just throw

try {
  await fred.processMessage(message);
} catch (error) {
  // Fred has already:
  // - Classified error (retryable/user/provider/infrastructure)
  // - Set span status (ok for user errors, error for system errors)
  // - Logged at appropriate level (warning/error)
  // - Attached error metadata to span

  // Just handle application logic
  console.error('Pipeline failed:', error);
}
```

### 7. Correlate with External Systems

Propagate trace context to external calls:

```typescript
// Fred automatically propagates runId, conversationId, workflowId
// Access via span attributes in your observability backend

// Search for all spans with runId: 'run-123'
// Group by conversationId for conversation view
// Filter by workflowId for workflow analytics
```

---

## Example: Full Configuration

```typescript
import { Fred } from '@fred/core';
import { LogLevel } from 'effect';

const fred = new Fred({
  observability: {
    otlp: {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      headers: process.env.OTEL_AUTH_TOKEN
        ? { 'Authorization': `Bearer ${process.env.OTEL_AUTH_TOKEN}` }
        : {},
    },
    logLevel: (process.env.FRED_LOG_LEVEL as any) || 'info',
    resource: {
      serviceName: 'fred-app',
      serviceVersion: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    },
    enableConsoleFallback: process.env.NODE_ENV !== 'production',
    verbosity: {
      gateTokenStreams: true,
      gateHeartbeats: true,
      highVolumeLevel: 'debug',
    },
  },
});

// Set custom redaction filter
fred.toolRegistry.setRedactionFilter((payload, context) => {
  // Debug mode: show everything
  if (context.logLevel === LogLevel.Debug || context.logLevel === LogLevel.Trace) {
    return payload;
  }

  // Redact sensitive fields
  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as any;
    const redacted = { ...obj };

    // Mask known sensitive fields
    const sensitiveFields = ['apiKey', 'password', 'token', 'secret', 'credential'];
    for (const field of sensitiveFields) {
      if (field in redacted) {
        redacted[field] = '[MASKED]';
      }
    }

    return redacted;
  }

  // Default: redact all payloads
  return '[REDACTED]';
});

// Execute with per-run overrides
const result = await fred.processMessage('user message', {
  conversationId: 'conv-123',
  runId: 'run-456',
  observability: {
    logLevel: 'trace', // Override for this specific run
    verbosity: {
      gateTokenStreams: false, // Show tokens for debugging this run
    },
  },
});
```

## Troubleshooting

### Spans Not Appearing in Backend

1. Check OTLP endpoint is correct
2. Verify network connectivity to collector
3. Check authentication headers
4. Enable console fallback to see local output:
   ```typescript
   observability: {
     enableConsoleFallback: true,
   }
   ```

### Too Many Logs in Production

1. Increase log level to `info` or `warning`
2. Enable token/heartbeat gating:
   ```typescript
   verbosity: {
     gateTokenStreams: true,
     gateHeartbeats: true,
   }
   ```

### Sensitive Data in Traces

1. Set custom redaction filter (see examples above)
2. Lower log level to reduce payload logging
3. Review error messages for sensitive content

### Missing Identifiers on Spans

1. Ensure `runId` and `conversationId` passed to execution
2. Check `workflowId` set in pipeline context
3. Verify Effect observability layers are provided to runtime

---

For more information on Effect observability, see:
- [Effect Logging Documentation](https://effect.website/docs/observability/logging/)
- [Effect Tracing Documentation](https://effect.website/docs/observability/tracing/)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/)
