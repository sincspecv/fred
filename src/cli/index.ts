#!/usr/bin/env bun

/**
 * Fred CLI
 * Main entry point for CLI commands
 */

import { handleTestCommand } from './test';
import { handleDevCommand } from './dev';

/**
 * Options that require a value
 */
const OPTIONS_REQUIRING_VALUE = new Set([
  'record',
  'config',
  'traces-dir',
  'tracesDir',
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
  dev                     Start development chat interface with hot reload
  test                    Run golden trace tests
  test --record <message>  Record a new golden trace
  test --update            Update existing golden traces
  test <pattern>           Run tests matching pattern

Options:
  --config <file>          Path to Fred config file
  --traces-dir <dir>       Directory for golden traces (default: tests/golden-traces)

Examples:
  fred dev
  fred test
  fred test --record "Hello, world!"
  fred test --update
  fred test --config fred.config.yaml
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
      case 'dev':
        exitCode = await handleDevCommand();
        break;

      case 'test':
        exitCode = await handleTestCommand(commandArgs, {
          pattern: commandArgs[0],
          update: options.update === true,
          record: options.record,
          tracesDir: options['traces-dir'] || options.tracesDir,
          configFile: options.config,
        });
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
