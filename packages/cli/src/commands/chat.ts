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
 * In interactive mode, OpenTUI manages the terminal lifecycle (alternate screen, raw mode, cleanup).
 */
export async function handleChatCommand(): Promise<void> {
  const mode = detectTerminalMode();

  // Interactive TTY mode — launch TUI shell
  if (mode.mode === 'interactive-tty') {
    const app = await createFredTuiApp({
      onQuit: () => {
        console.log('Exiting Fred chat...');
        process.exit(0);
      },
      onError: (error) => {
        console.error('TUI error:', error);
        process.exit(1);
      },
    });

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
