#!/usr/bin/env bun

/**
 * Fred CLI
 * Main entry point for CLI commands
 */

import { handleTestCommand } from './test';
import { handleDevCommand } from './dev';
import { handleEvalCommand } from './eval';
import { handleChatCommand } from './commands/chat';

/**
 * Options that require a value
 */
const OPTIONS_REQUIRING_VALUE = new Set([
  'record',
  'config',
  'traces-dir',
  'tracesDir',
  'run-id',
  'runId',
  'trace-id',
  'traceId',
  'from-step',
  'fromStep',
  'suite',
  'suite-file',
  'suiteFile',
  'output',
  'baseline',
  'candidate',
  'mode',
]);

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): { command: string; args: string[]; options: Record<string, any> } {
  const command = args[0] || 'help';
  const remainingArgs: string[] = [];
  const options: Record<string, any> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const nextArg = args[i + 1];
      const requiresValue = OPTIONS_REQUIRING_VALUE.has(key);

      // Check if option requires a value
      if (requiresValue) {
        // Validate that a value is provided
        if (nextArg === undefined || nextArg.startsWith('--')) {
          throw new Error(`Option --${key} requires a value. Example: --${key} <value>`);
        }
        options[key] = nextArg;
        i++; // Skip next arg as it's the value
      } else {
        // Handle boolean flags (options that don't require values)
        if (nextArg === undefined || nextArg.startsWith('--')) {
          options[key] = true;
        } else {
          // If a value is provided for a boolean flag, treat it as the value
          // (some flags might accept optional values)
          options[key] = nextArg;
          i++; // Skip next arg as it's the value
        }
      }
    } else {
      remainingArgs.push(arg);
    }
  }

  return { command, args: remainingArgs, options };
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Fred CLI

Usage:
  fred <command> [options]

Commands:
  chat, tui               Start interactive chat interface
                          - Full-screen TUI with streaming output
                          - If your project exports setup(fred) from src/index.(ts|js) or index.(ts|js), it will be executed before chat starts
  dev                     Start development chat interface with hot reload (deprecated - use 'chat')
                          - If your project exports setup(fred) from src/index.(ts|js) or index.(ts|js), it will be executed before chat starts
  test                    Run golden trace tests
  test --record <message>  Record a new golden trace
  test --update            Update existing golden traces
  test <pattern>           Run tests matching pattern
  eval                    Run evaluation workflows
  eval record --run-id <id>           Record evaluation artifact for a run
  eval replay --trace-id <id>         Replay run from checkpoint (config optional; uses artifact data when no config)
                                    Optional: --from-step <n> --mode retry|skip|restart --config <file>
  eval compare --baseline <id> --candidate <id>  Compare two evaluation traces
  eval suite --suite <file>           Run evaluation suite manifest
                                    Outputs: pass/fail totals, latency/token metrics, intent confusion matrix

Options:
  --config <file>          Path to Fred config file
  --traces-dir <dir>       Directory for golden traces (default: tests/golden-traces)

Examples:
  fred chat
  fred dev
  fred test
  fred test --record "Hello, world!"
  fred test --update
  fred test --config fred.config.yaml
  fred eval record --run-id run-123 --output json
  fred eval replay --trace-id trace-abc --from-step 2
  fred eval compare --baseline trace-a --candidate trace-b
  fred eval suite --suite ./eval/suite.yaml --output json

Get started:
  Run 'fred chat' to start an interactive session with your AI agents.
  `);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const { command, args: commandArgs, options } = parseArgs(args);

  try {
    let exitCode = 0;

    switch (command) {
      case 'chat':
      case 'tui':
        // handleChatCommand uses BunRuntime.runMain internally (via startDevChat) and never returns
        // It handles signals and cleanup, and exits the process
        handleChatCommand();
        // This line is never reached
        return;

      case 'dev':
        // handleDevCommand uses BunRuntime.runMain internally and never returns
        // It handles signals and cleanup, and exits the process
        handleDevCommand();
        // This line is never reached
        return;

      case 'test':
        exitCode = await handleTestCommand(commandArgs, {
          pattern: commandArgs[0],
          update: options.update === true,
          record: options.record,
          tracesDir: options['traces-dir'] || options.tracesDir,
          configFile: options.config,
        });
        break;

      case 'eval':
        exitCode = await handleEvalCommand(commandArgs, options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        exitCode = 1;
    }

    process.exit(exitCode);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
