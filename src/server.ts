#!/usr/bin/env bun

import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { Fred } from './index';
import { ServerApp } from './server/app';

/**
 * Server mode entry point
 * Can be run with: bun run src/server.ts
 * Or with config: bun run src/server.ts --config path/to/config.json
 */

/**
 * Parse command line arguments
 */
function parseArgs(): { configPath?: string; port: number } {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');

  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) : 3000;

  return { configPath, port };
}

/**
 * Initialize Fred from config or with default providers
 */
function initializeFred(fred: Fred, configPath?: string): Effect.Effect<void, Error> {
  if (configPath) {
    return Effect.tryPromise({
      try: async () => {
        await fred.initializeFromConfig(configPath);
        console.log(`Initialized from config: ${configPath}`);
      },
      catch: (error) => new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    });
  } else {
    return Effect.tryPromise({
      try: async () => {
        await fred.registerDefaultProviders();
        console.log('No config file provided. Using default providers.');
        console.log('Register agents, intents, and tools programmatically or provide a config file.');
      },
      catch: (error) => new Error(`Failed to register providers: ${error instanceof Error ? error.message : String(error)}`)
    });
  }
}

/**
 * Main server program using Effect
 */
const program = Effect.gen(function* () {
  // Parse args synchronously
  const { configPath, port } = parseArgs();

  // Create Fred instance (no cleanup needed - Fred has no shutdown method)
  const fred = new Fred();

  // Initialize Fred
  yield* initializeFred(fred, configPath);

  // Create and start server with finalizer for graceful shutdown
  const app = new ServerApp(fred);
  yield* Effect.acquireRelease(
    Effect.promise(() => app.start(port)),
    () => Effect.promise(() => app.stop())
  );

  // Keep running until interrupted (SIGINT/SIGTERM)
  yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error('Failed to start server:', error);
      process.exit(1);
    })
  )
);

// Run if this is the main module
if (import.meta.main) {
  BunRuntime.runMain(program);
}

export { ServerApp };
