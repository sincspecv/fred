#!/usr/bin/env bun

/**
 * Dev command handler
 * Starts the development chat interface with hot reload
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { Fred } from '@fancyrobot/fred';
import { startDevChat } from '@fancyrobot/fred-dev';

/**
 * Try to load and call project's setup() function if it exists
 */
async function loadProjectSetup(fred: Fred): Promise<void> {
  // Try to find project's index.ts or src/index.ts
  const possiblePaths = [
    resolve(process.cwd(), 'src', 'index.ts'),
    resolve(process.cwd(), 'index.ts'),
    resolve(process.cwd(), 'src', 'index.js'),
    resolve(process.cwd(), 'index.js'),
  ];

  for (const indexPath of possiblePaths) {
    if (existsSync(indexPath)) {
      try {
        // Dynamically import the project's index file
        // Bun natively supports TypeScript imports, so we can import .ts files directly
        const projectModule = await import(pathToFileURL(indexPath).href);

        // Check if setup function is exported
        if (typeof projectModule.setup === 'function') {
          // Call the setup function with the Fred instance
          await projectModule.setup(fred);
          return;
        }
      } catch (error) {
        // If import fails (e.g., syntax error, missing dependencies), continue to next path
        // This is expected if the file has errors or doesn't export setup
        continue;
      }
    }
  }

  // If no setup function found, that's okay - dev-chat will use auto-agent creation
}

/**
 * Handle dev command
 * Uses BunRuntime.runMain internally via startDevChat for proper signal handling.
 * This function never returns - it runs until interrupted.
 */
export function handleDevCommand(): void {
  const setupHook = async (fred: Fred) => {
    await loadProjectSetup(fred);
  };

  // startDevChat uses BunRuntime.runMain internally
  // It will handle signals and cleanup, and never returns
  startDevChat(setupHook);
}
