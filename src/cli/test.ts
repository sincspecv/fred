import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { Fred } from '../index';
import { NoOpTracer } from '../core/tracing/noop-tracer';
import { GoldenTraceRecorder } from '../core/eval/recorder';
import { loadGoldenTrace, runTestCase, formatTestResults, TestCase } from '../core/eval/assertion-runner';
import { createHash } from 'crypto';

/**
 * Test command options
 */
export interface TestCommandOptions {
  pattern?: string;
  update?: boolean;
  record?: string;
  tracesDir?: string;
  configFile?: string;
}

/**
 * Find all golden trace files
 */
async function findGoldenTraces(tracesDir: string): Promise<string[]> {
  if (!existsSync(tracesDir)) {
    return [];
  }

  const files = await readdir(tracesDir);
  return files
    .filter(file => file.endsWith('.json') && file.startsWith('trace-v'))
    .map(file => join(tracesDir, file));
}

/**
 * Find test case files (JSON files with test definitions)
 */
async function findTestCases(tracesDir: string): Promise<TestCase[]> {
  const testCaseFile = join(tracesDir, 'test-cases.json');
  
  if (!existsSync(testCaseFile)) {
    return [];
  }

  const content = await readFile(testCaseFile, 'utf-8');
  const testCases = JSON.parse(content);
  
  if (!Array.isArray(testCases)) {
    throw new Error('test-cases.json must contain an array of test cases');
  }

  return testCases;
}

/**
 * Record a new golden trace
 */
export async function recordTrace(
  message: string,
  fred: Fred,
  tracesDir: string,
  options?: { conversationId?: string }
): Promise<string> {
  // Create recorder with a base tracer
  const baseTracer = new NoOpTracer();
  const recorder = new GoldenTraceRecorder(baseTracer);
  
  // Create tracer with callback to automatically capture spans
  const tracer = new NoOpTracer((span) => {
    recorder.addSpan(span);
  });
  
  // Enable tracing with the callback-enabled tracer
  fred.enableTracing(tracer);

  // Record message
  recorder.recordMessage(message);

  // Process message (spans will be automatically captured via callback)
  const response = await fred.processMessage(message, {
    conversationId: options?.conversationId,
  });

  if (!response) {
    throw new Error('No response from agent');
  }

  // Record response
  recorder.recordResponse(response);

  // Save trace (spans are already captured via callback)
  const filepath = await recorder.saveToFile(tracesDir);
  console.log(`✓ Recorded golden trace: ${filepath}`);
  
  return filepath;
}

/**
 * Run golden trace tests
 */
export async function runTests(
  tracesDir: string,
  pattern?: string
): Promise<boolean> {
  // Find test cases
  const testCases = await findTestCases(tracesDir);

  if (testCases.length === 0) {
    console.log('No test cases found. Create a test-cases.json file in the traces directory.');
    return true;
  }

  // Filter by pattern if provided
  const filteredCases = pattern
    ? testCases.filter(tc => tc.name.includes(pattern))
    : testCases;

  if (filteredCases.length === 0) {
    console.log(`No test cases match pattern: ${pattern}`);
    return true;
  }

  // Run tests
  const results = [];
  for (const testCase of filteredCases) {
    const result = await runTestCase(testCase, tracesDir);
    results.push(result);
  }

  // Display results
  console.log(formatTestResults(results));

  // Return success if all passed
  return results.every(r => r.passed);
}

/**
 * Update golden traces
 */
export async function updateTraces(
  tracesDir: string,
  fred: Fred,
  pattern?: string
): Promise<void> {
  const traceFiles = await findGoldenTraces(tracesDir);

  if (traceFiles.length === 0) {
    console.log('No golden traces found to update.');
    return;
  }

  // Filter by pattern if provided
  const filteredFiles = pattern
    ? traceFiles.filter(file => file.includes(pattern))
    : traceFiles;

  for (const traceFile of filteredFiles) {
    const trace = await loadGoldenTrace(traceFile);
    const message = trace.trace.message;

    console.log(`Updating trace for: "${message.substring(0, 50)}..."`);

    // Re-record trace
    await recordTrace(message, fred, tracesDir, {
      conversationId: trace.metadata.config?.conversationId,
    });

    // Remove old trace file
    // Note: In practice, you might want to keep old traces for comparison
    // await unlink(traceFile);
  }

  console.log(`✓ Updated ${filteredFiles.length} trace(s)`);
}

/**
 * Main test command handler
 */
export async function handleTestCommand(
  args: string[],
  options: TestCommandOptions
): Promise<number> {
  const tracesDir = options.tracesDir || resolve(process.cwd(), 'tests', 'golden-traces');

  // Ensure traces directory exists
  if (!existsSync(tracesDir)) {
    await mkdir(tracesDir, { recursive: true });
  }

  try {
    // Handle record command
    if (options.record) {
      // Load Fred instance
      let fred: Fred;
      if (options.configFile) {
        fred = new Fred();
        await fred.initializeFromConfig(options.configFile);
      } else {
        // Try to find default config
        const defaultConfigs = ['fred.config.yaml', 'fred.config.yml', 'fred.config.json'];
        let configFound = false;
        
        for (const configFile of defaultConfigs) {
          if (existsSync(configFile)) {
            fred = new Fred();
            await fred.initializeFromConfig(configFile);
            configFound = true;
            break;
          }
        }

        if (!configFound) {
          console.error('No config file found. Use --config to specify one.');
          return 1;
        }
      }

      await recordTrace(options.record, fred, tracesDir);
      return 0;
    }

    // Handle update command
    if (options.update) {
      // Load Fred instance
      let fred: Fred;
      if (options.configFile) {
        fred = new Fred();
        await fred.initializeFromConfig(options.configFile);
      } else {
        const defaultConfigs = ['fred.config.yaml', 'fred.config.yml', 'fred.config.json'];
        let configFound = false;
        
        for (const configFile of defaultConfigs) {
          if (existsSync(configFile)) {
            fred = new Fred();
            await fred.initializeFromConfig(configFile);
            configFound = true;
            break;
          }
        }

        if (!configFound) {
          console.error('No config file found. Use --config to specify one.');
          return 1;
        }
      }

      await updateTraces(tracesDir, fred, options.pattern);
      return 0;
    }

    // Handle run command (default)
    const success = await runTests(tracesDir, options.pattern);
    return success ? 0 : 1;
  } catch (error) {
    console.error('Error running tests:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}
