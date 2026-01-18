#!/usr/bin/env bun

/**
 * Dev command handler
 * Starts the development chat interface with hot reload
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { Fred } from '../index';
import { startDevChat } from '../dev-chat';

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
 */
export async function handleDevCommand(): Promise<number> {
  try {
    // Create a setup hook that will be called by dev-chat
    const setupHook = async (fred: Fred) => {
      await loadProjectSetup(fred);
    };

    // Start the dev chat with the setup hook
    await startDevChat(setupHook);
    
    // startDevChat runs indefinitely, so this should never be reached
    return 0;
  } catch (error) {
    console.error('Error starting dev chat:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return 1;
  }
}
