import { Schema } from 'effect';
import { calculateSimilarity } from '../utils/semantic';
import { validateGoldenTrace } from './golden-trace';
import type { GoldenTrace } from './golden-trace';

export interface AssertionResult {
  type: AssertionSpec['type'];
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

const UnknownRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const ToolCallExpectationSchema = Schema.Struct({
  toolId: Schema.String.pipe(Schema.minLength(1)),
  argsContains: Schema.optional(UnknownRecordSchema),
});

const ToolCallsAssertionSpecSchema = Schema.Struct({
  type: Schema.Literal('tool.calls'),
  expected: Schema.Array(ToolCallExpectationSchema).pipe(Schema.minItems(1)),
});

const RoutingAssertionSpecSchema = Schema.Struct({
  type: Schema.Literal('routing'),
  expected: Schema.Struct({
    method: Schema.optional(Schema.Union(
      Schema.Literal('agent.utterance'),
      Schema.Literal('intent.matching'),
      Schema.Literal('default.agent')
    )),
    agentId: Schema.optional(Schema.String),
    intentId: Schema.optional(Schema.String),
    matchType: Schema.optional(Schema.Union(
      Schema.Literal('exact'),
      Schema.Literal('regex'),
      Schema.Literal('semantic')
    )),
  }),
});

const ResponseAssertionSpecSchema = Schema.Struct({
  type: Schema.Literal('response'),
  pathEquals: Schema.optional(UnknownRecordSchema),
  text: Schema.optional(Schema.String),
  semanticThreshold: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  caseSensitive: Schema.optional(Schema.Boolean),
});

const CheckpointAssertionSpecSchema = Schema.Struct({
  type: Schema.Literal('checkpoint'),
  expected: Schema.Struct({
    step: Schema.optional(Schema.Number.pipe(Schema.int())),
    stepName: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
    minCount: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1))),
  }),
});

const SchemaAssertionSpecSchema = Schema.Struct({
  type: Schema.Literal('schema'),
});

export const AssertionSpecSchema = Schema.Union(
  ToolCallsAssertionSpecSchema,
  RoutingAssertionSpecSchema,
  ResponseAssertionSpecSchema,
  CheckpointAssertionSpecSchema,
  SchemaAssertionSpecSchema
);

export const AssertionSuiteSchema = Schema.Array(AssertionSpecSchema).pipe(Schema.minItems(1));

export type ToolCallsAssertionSpec = typeof ToolCallsAssertionSpecSchema.Type;
export type RoutingAssertionSpec = typeof RoutingAssertionSpecSchema.Type;
export type ResponseAssertionSpec = typeof ResponseAssertionSpecSchema.Type;
export type CheckpointAssertionSpec = typeof CheckpointAssertionSpecSchema.Type;
export type SchemaAssertionSpec = typeof SchemaAssertionSpecSchema.Type;

export type AssertionSpec =
  | ToolCallsAssertionSpec
  | RoutingAssertionSpec
  | ResponseAssertionSpec
  | CheckpointAssertionSpec
  | SchemaAssertionSpec;

export function decodeAssertionSpecs(specs: unknown): AssertionSpec[] {
  return Array.from(Schema.decodeUnknownSync(AssertionSuiteSchema, { errors: 'all' })(specs));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item, index) => partialMatch(actual[index], item));
  }

  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    return Object.entries(expected).every(([key, expectedValue]) => partialMatch(actual[key], expectedValue));
  }

  return Object.is(actual, expected);
}

function getPathValue(value: unknown, path: string): unknown {
  if (!path) return value;
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => (isObject(current) ? current[segment] : undefined), value);
}

function assertToolCalls(trace: GoldenTrace, spec: ToolCallsAssertionSpec): AssertionResult {
  const missingExpectedCalls: Array<{ toolId: string; argsContains?: Record<string, unknown> }> = [];

  for (const expectation of spec.expected) {
    const found = trace.trace.toolCalls.some((toolCall) => {
      if (toolCall.toolId !== expectation.toolId) {
        return false;
      }

      if (!expectation.argsContains) {
        return true;
      }

      return partialMatch(toolCall.args, expectation.argsContains);
    });

    if (!found) {
      missingExpectedCalls.push(expectation);
    }
  }

  if (missingExpectedCalls.length > 0) {
    return {
      type: spec.type,
      passed: false,
      message: `Missing ${missingExpectedCalls.length} expected tool call(s)`,
      details: {
        missingExpectedCalls,
        actualToolCalls: trace.trace.toolCalls.map((toolCall) => ({
          toolId: toolCall.toolId,
          args: toolCall.args,
        })),
      },
    };
  }

  return {
    type: spec.type,
    passed: true,
    message: `All ${spec.expected.length} expected tool call(s) were found`,
  };
}

function assertRouting(trace: GoldenTrace, spec: RoutingAssertionSpec): AssertionResult {
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = [];
  const actual = trace.trace.routing;

  for (const [field, expectedValue] of Object.entries(spec.expected)) {
    if (expectedValue === undefined) continue;
    const actualValue = actual[field as keyof typeof actual];
    if (!Object.is(actualValue, expectedValue)) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }

  if (mismatches.length > 0) {
    return {
      type: spec.type,
      passed: false,
      message: 'Routing assertion failed',
      details: {
        expected: spec.expected,
        actual,
        mismatches,
      },
    };
  }

  return {
    type: spec.type,
    passed: true,
    message: 'Routing assertion passed',
  };
}

function assertResponse(trace: GoldenTrace, spec: ResponseAssertionSpec): AssertionResult {
  const pathMismatches: Array<{ path: string; expected: unknown; actual: unknown }> = [];

  if (spec.pathEquals) {
    for (const [path, expected] of Object.entries(spec.pathEquals)) {
      const actual = getPathValue(trace.trace.response, path);
      if (!partialMatch(actual, expected)) {
        pathMismatches.push({ path, expected, actual });
      }
    }
  }

  let similarity: number | undefined;
  if (spec.text !== undefined) {
    const caseSensitive = spec.caseSensitive ?? false;
    const threshold = spec.semanticThreshold ?? 0.75;
    const expected = caseSensitive ? spec.text : spec.text.toLowerCase();
    const actual = caseSensitive ? trace.trace.response.content : trace.trace.response.content.toLowerCase();
    similarity = calculateSimilarity(actual, expected);

    if (similarity < threshold) {
      return {
        type: spec.type,
        passed: false,
        message: 'Response text semantic similarity below threshold',
        details: {
          expected: spec.text,
          actual: trace.trace.response.content,
          threshold,
          similarity,
          pathMismatches,
        },
      };
    }
  }

  if (pathMismatches.length > 0) {
    return {
      type: spec.type,
      passed: false,
      message: 'Response structured path checks failed',
      details: {
        pathMismatches,
        similarity,
      },
    };
  }

  return {
    type: spec.type,
    passed: true,
    message: 'Response assertion passed',
    details: similarity === undefined ? undefined : { similarity },
  };
}

function assertCheckpoint(trace: GoldenTrace, spec: CheckpointAssertionSpec): AssertionResult {
  const minCount = spec.expected.minCount ?? 1;

  const matches = trace.trace.spans.filter((span) => {
    if (spec.expected.step !== undefined) {
      const step = span.attributes.step;
      if (typeof step !== 'number' || step !== spec.expected.step) {
        return false;
      }
    }

    if (spec.expected.stepName !== undefined) {
      if (span.name !== spec.expected.stepName) {
        return false;
      }
    }

    if (spec.expected.status !== undefined) {
      const status = typeof span.attributes.status === 'string' ? span.attributes.status : span.status.code;
      if (status !== spec.expected.status) {
        return false;
      }
    }

    return true;
  });

  if (matches.length < minCount) {
    return {
      type: spec.type,
      passed: false,
      message: `Expected at least ${minCount} checkpoint-like span(s), found ${matches.length}`,
      details: {
        expected: spec.expected,
        matched: matches.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          status: span.status,
        })),
      },
    };
  }

  return {
    type: spec.type,
    passed: true,
    message: `Checkpoint assertion passed with ${matches.length} match(es)`,
  };
}

export function runAssertion(trace: GoldenTrace, spec: AssertionSpec): AssertionResult {
  switch (spec.type) {
    case 'tool.calls':
      return assertToolCalls(trace, spec);
    case 'routing':
      return assertRouting(trace, spec);
    case 'response':
      return assertResponse(trace, spec);
    case 'checkpoint':
      return assertCheckpoint(trace, spec);
    case 'schema':
      const isValid = validateGoldenTrace(trace);
      return {
        type: spec.type,
        passed: isValid,
        message: isValid ? 'Trace schema is valid' : 'Trace schema is invalid',
      };
  }
}
