/**
 * TTY capability detection and output mode resolution
 */

/**
 * Terminal modes for CLI execution
 */
export type TerminalMode = 'interactive-tty' | 'non-interactive-tty' | 'non-tty';

/**
 * Terminal mode detection result
 */
export interface TerminalModeResult {
  mode: TerminalMode;
  canUseRawMode: boolean;
  isInteractive: boolean;
  reason: string;
}

/**
 * Detect terminal mode and capabilities
 *
 * Classifies terminal state to determine safe operations:
 * - interactive-tty: Full terminal control available
 * - non-interactive-tty: TTY exists but no interactive input
 * - non-tty: Piped or redirected I/O
 *
 * @returns Terminal mode detection result
 */
export function detectTerminalMode(): TerminalModeResult {
  const stdin = process.stdin;
  const stdout = process.stdout;

  // Check if both stdin and stdout are TTY
  const stdinIsTTY = stdin && typeof stdin.isTTY === 'boolean' && stdin.isTTY;
  const stdoutIsTTY = stdout && typeof stdout.isTTY === 'boolean' && stdout.isTTY;

  // Non-TTY: stdin or stdout is piped/redirected
  if (!stdinIsTTY || !stdoutIsTTY) {
    return {
      mode: 'non-tty',
      canUseRawMode: false,
      isInteractive: false,
      reason: `stdin TTY: ${stdinIsTTY}, stdout TTY: ${stdoutIsTTY}`,
    };
  }

  // Check if setRawMode is available (required for interactive mode)
  const hasSetRawMode = typeof stdin.setRawMode === 'function';

  if (!hasSetRawMode) {
    return {
      mode: 'non-interactive-tty',
      canUseRawMode: false,
      isInteractive: false,
      reason: 'stdin.setRawMode not available',
    };
  }

  // Check if we can actually call setRawMode (some TTY environments don't support it)
  try {
    // Test setRawMode by toggling it - if this fails, we can't use interactive mode
    const currentMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.setRawMode(currentMode || false);

    return {
      mode: 'interactive-tty',
      canUseRawMode: true,
      isInteractive: true,
      reason: 'Full TTY with raw mode support',
    };
  } catch (error) {
    return {
      mode: 'non-interactive-tty',
      canUseRawMode: false,
      isInteractive: false,
      reason: `setRawMode test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
