/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Fred } from '@fancyrobot/fred';
import { startDevChat } from '@fancyrobot/fred-dev';
import { detectTerminalMode } from '../runtime/tty-mode.js';
import { createFredTuiApp } from '../tui/app.js';
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
 * Launches TUI shell in interactive mode, or provides structured output otherwise.
 * This function never returns in interactive mode - it runs until interrupted.
 */
export function handleChatCommand(): void {
  const mode = detectTerminalMode();

  // Interactive TTY mode - start TUI shell
  if (mode.mode === 'interactive-tty') {
    // Launch TUI app with terminal lifecycle hooks
    const app = createFredTuiApp(
      {
        terminalWidth: process.stdout.columns || 120,
        terminalHeight: process.stdout.rows || 40,
        showStartupHint: true,
      },
      {
        onStateChange: (state) => {
          // State changes will be handled by rendering engine
          // For now, this is a placeholder for future integration
        },
        onQuit: () => {
          console.log('\nExiting Fred chat...');
          process.exit(0);
        },
        onError: (error) => {
          console.error('TUI error:', error);
          process.exit(1);
        },
      }
    );

    // Set up keyboard input handling (placeholder for full implementation)
    // In Phase 28, this will be enhanced with proper raw mode and stdin reading

    // For now, just show that the TUI app was created and started
    console.log('TUI shell initialized. Press Ctrl+C to exit.');

    // Keep process alive
    process.stdin.resume();

    // Handle Ctrl+C for now
    process.on('SIGINT', () => {
      app.stop();
    });

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
