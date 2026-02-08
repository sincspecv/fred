/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { detectTerminalMode } from '../runtime/tty-mode.js';
import { createFredTuiApp } from '../tui/app.js';

/**
 * Handle chat command
 *
 * Routes to interactive TUI when TTY is available, or non-interactive mode otherwise.
 * This function never returns in interactive mode — it runs until the user quits.
 */
export function handleChatCommand(): void {
  const mode = detectTerminalMode();

  // Interactive TTY mode — launch TUI shell
  if (mode.mode === 'interactive-tty') {
    const app = createFredTuiApp(
      {
        terminalWidth: process.stdout.columns || 120,
        terminalHeight: process.stdout.rows || 40,
        showStartupHint: true,
      },
      {
        onQuit: () => {
          console.log('Exiting Fred chat...');
          process.exit(0);
        },
        onError: (error) => {
          console.error('TUI error:', error);
          process.exit(1);
        },
      }
    );

    // Handle SIGINT as backup (app also handles Ctrl+C via keymap)
    process.on('SIGINT', () => {
      app.stop();
    });

    return;
  }

  // Non-TTY mode — provide structured output
  console.log(JSON.stringify({
    mode: 'non-interactive',
    reason: mode.reason,
    suggestion: 'Run fred chat in a terminal for interactive mode',
    help: 'Use fred --help for other commands',
  }, null, 2));

  process.exit(1);
}
