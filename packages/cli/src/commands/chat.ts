/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Fred } from '@fancyrobot/fred';
import { startDevChat } from '@fancyrobot/fred-dev';
import { detectTerminalMode } from '../runtime/tty-mode';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

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
 * Handle chat command
 *
 * Routes to interactive mode when TTY is available, or non-interactive mode otherwise.
 * Uses BunRuntime.runMain internally via startDevChat for proper signal handling.
 * This function never returns in interactive mode - it runs until interrupted.
 */
export function handleChatCommand(): void {
  const mode = detectTerminalMode();

  // Interactive TTY mode - start full chat interface
  if (mode.mode === 'interactive-tty') {
    const setupHook = async (fred: Fred) => {
      await loadProjectSetup(fred);
    };

    // startDevChat uses BunRuntime.runMain internally
    // It will handle signals and cleanup, and never returns
    startDevChat(setupHook);
    // This line is never reached in interactive mode
    return;
  }

  // Non-TTY mode - provide structured output
  console.log(JSON.stringify({
    mode: 'non-interactive',
    reason: mode.reason,
    suggestion: 'Run fred chat in a terminal for interactive mode',
    help: 'Use fred --help for other commands',
  }, null, 2));

  process.exit(1);
}
