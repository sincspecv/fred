/**
 * Terminal lifecycle manager with Effect-scoped cleanup
 *
 * Manages terminal state (raw mode, cursor, alternate screen) with guaranteed
 * restoration on success, error, and interruption.
 */

import { Effect } from 'effect';
import { detectTerminalMode } from './tty-mode';

/**
 * Terminal state to be managed
 */
interface TerminalState {
  wasRawMode: boolean;
  cursorHidden: boolean;
  alternateScreenActive: boolean;
}

/**
 * Current terminal state (module-level for defensive cleanup)
 */
let currentState: TerminalState | null = null;

/**
 * Restore terminal to its original state
 *
 * Idempotent - safe to call multiple times.
 * Works even if stdin/stdout are no longer available.
 */
export function restoreTerminalState(): void {
  if (!currentState) {
    // Nothing to restore
    return;
  }

  const stdin = process.stdin;
  const stdout = process.stdout;

  try {
    // Restore raw mode if stdin is available and supports it
    if (stdin && !stdin.destroyed && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(currentState.wasRawMode);
      } catch {
        // Ignore - stdin may no longer be available
      }
    }

    // Show cursor if it was hidden and stdout is available
    if (currentState.cursorHidden && stdout && !stdout.destroyed && stdout.writable) {
      try {
        stdout.write('\x1b[?25h'); // Show cursor
      } catch {
        // Ignore - stdout may no longer be available
      }
    }

    // Exit alternate screen if active and stdout is available
    if (currentState.alternateScreenActive && stdout && !stdout.destroyed && stdout.writable) {
      try {
        stdout.write('\x1b[?1049l'); // Exit alternate screen
      } catch {
        // Ignore - stdout may no longer be available
      }
    }
  } finally {
    // Always clear state, even if restoration partially failed
    currentState = null;
  }
}

/**
 * Defensive cleanup handler for process exit
 *
 * Ensures terminal is restored even if Effect cleanup doesn't run
 * (e.g., process.exit() called directly, SIGKILL, etc.)
 */
function installExitHandler(): void {
  // Only install once
  if (process.listenerCount('exit') === 0) {
    process.on('exit', () => {
      restoreTerminalState();
    });
  }

  // Also handle SIGINT and SIGTERM
  const signals = ['SIGINT', 'SIGTERM'] as const;
  signals.forEach((signal) => {
    if (process.listenerCount(signal) === 0) {
      process.on(signal, () => {
        restoreTerminalState();
        process.exit(0);
      });
    }
  });
}

/**
 * Options for terminal lifecycle
 */
export interface TerminalLifecycleOptions {
  /**
   * Enable raw mode for character-level input
   * @default true
   */
  rawMode?: boolean;

  /**
   * Hide cursor during operation
   * @default false
   */
  hideCursor?: boolean;

  /**
   * Use alternate screen buffer
   * @default false
   */
  alternateScreen?: boolean;
}

/**
 * Enter interactive terminal mode
 *
 * Only works in interactive-tty mode. Returns Effect that fails
 * if terminal capabilities are insufficient.
 */
function enterTerminalMode(options: TerminalLifecycleOptions): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const detection = detectTerminalMode();

    // Guard: Only allow interactive mode in interactive-tty
    if (detection.mode !== 'interactive-tty') {
      yield* Effect.fail(
        new Error(
          `Cannot enter interactive terminal mode: ${detection.reason}. ` +
            `Terminal mode is ${detection.mode}, but interactive-tty is required.`
        )
      );
    }

    const stdin = process.stdin;
    const stdout = process.stdout;

    // Save current state
    currentState = {
      wasRawMode: stdin.isRaw || false,
      cursorHidden: false,
      alternateScreenActive: false,
    };

    // Install defensive exit handler
    installExitHandler();

    // Enable raw mode if requested
    if (options.rawMode !== false) {
      try {
        stdin.setRawMode(true);
      } catch (error) {
        yield* Effect.fail(
          new Error(
            `Failed to enable raw mode: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }

    // Hide cursor if requested
    if (options.hideCursor) {
      try {
        stdout.write('\x1b[?25l'); // Hide cursor
        if (currentState) {
          currentState.cursorHidden = true;
        }
      } catch (error) {
        yield* Effect.fail(
          new Error(
            `Failed to hide cursor: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }

    // Enter alternate screen if requested
    if (options.alternateScreen) {
      try {
        stdout.write('\x1b[?1049h'); // Enter alternate screen
        if (currentState) {
          currentState.alternateScreenActive = true;
        }
      } catch (error) {
        yield* Effect.fail(
          new Error(
            `Failed to enter alternate screen: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    }
  });
}

/**
 * Effect-scoped terminal lifecycle manager
 *
 * Wraps a program that requires interactive terminal access with automatic
 * state restoration on success, failure, or interruption.
 *
 * Usage:
 * ```typescript
 * const program = Effect.gen(function* () {
 *   // Your interactive program here
 *   yield* someInteractiveOperation();
 * });
 *
 * const withTerminal = withTerminalLifecycle(program, {
 *   rawMode: true,
 *   hideCursor: true,
 * });
 *
 * await Effect.runPromise(withTerminal);
 * ```
 *
 * @param program Effect program to run with terminal lifecycle
 * @param options Terminal mode options
 * @returns Effect with terminal lifecycle wrapped around program
 */
export function withTerminalLifecycle<A, E>(
  program: Effect.Effect<A, E>,
  options: TerminalLifecycleOptions = {}
): Effect.Effect<A, E | Error> {
  return Effect.acquireUseRelease(
    // Acquire: Enter terminal mode
    enterTerminalMode(options),
    // Use: Run the program
    () => program,
    // Release: Always restore terminal state (runs on success, failure, and interruption)
    () =>
      Effect.sync(() => {
        restoreTerminalState();
      })
  );
}
