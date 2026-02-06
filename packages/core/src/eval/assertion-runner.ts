import { validateGoldenTrace } from './golden-trace';
import { decodeAssertionSpecs, runAssertion } from './assertions';
import type { GoldenTrace } from './golden-trace';
import type { AssertionResult, AssertionSpec } from './assertions';
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Test case definition
 */
export interface TestCase {
  name: string;
  traceFile: string;
  assertions: unknown[];
}

/**
 * Test result
 */
export interface TestResult {
  testCase: string;
  passed: boolean;
  results: AssertionResult[];
  error?: string;
}

/**
 * Run assertions against a golden trace
 */
export async function runAssertions(
  trace: GoldenTrace,
  assertions: unknown[]
): Promise<AssertionResult[]> {
  let typedSpecs: AssertionSpec[];

  try {
    typedSpecs = decodeAssertionSpecs(assertions);
  } catch (error) {
    return [{
      type: 'schema',
      passed: false,
      message: `Invalid assertion suite: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        assertions,
      },
    }];
  }

  return typedSpecs.map((spec) => runAssertion(trace, spec));
}

/**
 * Load a golden trace from file
 */
export async function loadGoldenTrace(filepath: string): Promise<GoldenTrace> {
  const content = await readFile(filepath, 'utf-8');
  const trace = JSON.parse(content);

  if (!validateGoldenTrace(trace)) {
    throw new Error(`Invalid golden trace format in ${filepath}`);
  }

  return trace;
}

/**
 * Run a test case
 */
export async function runTestCase(
  testCase: TestCase,
  tracesDirectory: string
): Promise<TestResult> {
  try {
    const tracePath = join(tracesDirectory, testCase.traceFile);
    const trace = await loadGoldenTrace(tracePath);
    const results = await runAssertions(trace, testCase.assertions);

    const passed = results.every(r => r.passed);

    return {
      testCase: testCase.name,
      passed,
      results,
    };
  } catch (error) {
    return {
      testCase: testCase.name,
      passed: false,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run multiple test cases
 */
export async function runTestCases(
  testCases: TestCase[],
  tracesDirectory: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const testCase of testCases) {
    const result = await runTestCase(testCase, tracesDirectory);
    results.push(result);
  }

  return results;
}

/**
 * Format test results for display
 */
export function formatTestResults(results: TestResult[]): string {
  const lines: string[] = [];
  let totalTests = results.length;
  let passedTests = results.filter(r => r.passed).length;
  let failedTests = totalTests - passedTests;

  lines.push(`\nTest Results: ${passedTests}/${totalTests} passed\n`);

  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    lines.push(`${status} ${result.testCase}`);

    if (!result.passed) {
      if (result.error) {
        lines.push(`  Error: ${result.error}`);
      } else {
        for (const assertionResult of result.results) {
          if (!assertionResult.passed) {
            lines.push(`  ✗ ${assertionResult.message}`);
            if (assertionResult.details) {
              lines.push(`    Details: ${JSON.stringify(assertionResult.details, null, 2)}`);
            }
          }
        }
      }
    }
  }

  lines.push(`\nSummary: ${passedTests} passed, ${failedTests} failed`);

  return lines.join('\n');
}
