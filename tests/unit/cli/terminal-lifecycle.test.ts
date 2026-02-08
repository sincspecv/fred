import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { Effect } from 'effect';
import {
  withTerminalLifecycle,
  restoreTerminalState,
} from '../../../packages/cli/src/runtime/terminal-lifecycle';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';

describe('Terminal Lifecycle', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
  });

  afterEach(() => {
    // Restore terminal state after each test
    restoreTerminalState();
  });

  describe('detectTerminalMode', () => {
    test('returns non-tty when stdin is not TTY', () => {
      // Mock stdin as non-TTY
      const mockStdin = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      const result = detectTerminalMode();

      expect(result.mode).toBe('non-tty');
      expect(result.canUseRawMode).toBe(false);
      expect(result.isInteractive).toBe(false);
      expect(result.reason).toContain('stdin TTY: false');

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    });

    test('returns non-tty when stdout is not TTY', () => {
      // Mock stdout as non-TTY
      const mockStdin = {
        isTTY: true,
        setRawMode: mock(() => {}),
      } as any;

      const mockStdout = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const result = detectTerminalMode();

      expect(result.mode).toBe('non-tty');
      expect(result.canUseRawMode).toBe(false);
      expect(result.isInteractive).toBe(false);
      expect(result.reason).toContain('stdout TTY: false');

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('returns non-interactive-tty when setRawMode is not available', () => {
      // Mock stdin as TTY but without setRawMode
      const mockStdin = {
        isTTY: true,
        // No setRawMode function
      } as any;

      const mockStdout = {
        isTTY: true,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const result = detectTerminalMode();

      expect(result.mode).toBe('non-interactive-tty');
      expect(result.canUseRawMode).toBe(false);
      expect(result.isInteractive).toBe(false);
      expect(result.reason).toContain('setRawMode not available');

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('returns non-interactive-tty when setRawMode throws', () => {
      // Mock stdin as TTY but setRawMode throws
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock(() => {
          throw new Error('setRawMode not supported');
        }),
      } as any;

      const mockStdout = {
        isTTY: true,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const result = detectTerminalMode();

      expect(result.mode).toBe('non-interactive-tty');
      expect(result.canUseRawMode).toBe(false);
      expect(result.isInteractive).toBe(false);
      expect(result.reason).toContain('setRawMode test failed');

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('returns interactive-tty when full capabilities available', () => {
      // Mock stdin as fully capable TTY
      let rawMode = false;
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
      } as any;

      const mockStdout = {
        isTTY: true,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const result = detectTerminalMode();

      expect(result.mode).toBe('interactive-tty');
      expect(result.canUseRawMode).toBe(true);
      expect(result.isInteractive).toBe(true);
      expect(result.reason).toContain('Full TTY');

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });
  });

  describe('withTerminalLifecycle', () => {
    test('fails when terminal mode is not interactive-tty', async () => {
      // Mock as non-TTY
      const mockStdin = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      const program = Effect.succeed('test');
      const withTerminal = withTerminalLifecycle(program);

      const result = await Effect.runPromise(Effect.either(withTerminal));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.message).toContain('Cannot enter interactive terminal mode');
      }

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    });

    test('restores terminal state on success', async () => {
      // Mock fully capable TTY
      let rawMode = false;
      const setRawModeMock = mock((mode: boolean) => {
        rawMode = mode;
      });

      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: setRawModeMock,
        destroyed: false,
      } as any;

      const writes: string[] = [];
      const mockStdout = {
        isTTY: true,
        writable: true,
        destroyed: false,
        write: mock((data: string) => {
          writes.push(data);
          return true;
        }),
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const program = Effect.succeed('test result');
      const withTerminal = withTerminalLifecycle(program, {
        rawMode: true,
        hideCursor: true,
      });

      const result = await Effect.runPromise(withTerminal);

      // Program succeeded
      expect(result).toBe('test result');

      // Raw mode was enabled then restored
      expect(setRawModeMock).toHaveBeenCalled();

      // Cursor was hidden then shown
      expect(writes).toContain('\x1b[?25l'); // Hide cursor
      expect(writes).toContain('\x1b[?25h'); // Show cursor

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('restores terminal state on error', async () => {
      // Mock fully capable TTY
      let rawMode = false;
      const setRawModeMock = mock((mode: boolean) => {
        rawMode = mode;
      });

      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: setRawModeMock,
        destroyed: false,
      } as any;

      const writes: string[] = [];
      const mockStdout = {
        isTTY: true,
        writable: true,
        destroyed: false,
        write: mock((data: string) => {
          writes.push(data);
          return true;
        }),
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      const program = Effect.fail(new Error('test error'));
      const withTerminal = withTerminalLifecycle(program, {
        rawMode: true,
        hideCursor: true,
      });

      const result = await Effect.runPromise(Effect.either(withTerminal));

      // Program failed
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.message).toBe('test error');
      }

      // Terminal state was restored despite error
      expect(setRawModeMock).toHaveBeenCalled();
      expect(writes).toContain('\x1b[?25l'); // Hide cursor
      expect(writes).toContain('\x1b[?25h'); // Show cursor

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('restores terminal state on interruption', async () => {
      // Mock fully capable TTY
      let rawMode = false;
      const setRawModeMock = mock((mode: boolean) => {
        rawMode = mode;
      });

      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: setRawModeMock,
        destroyed: false,
      } as any;

      const writes: string[] = [];
      const mockStdout = {
        isTTY: true,
        writable: true,
        destroyed: false,
        write: mock((data: string) => {
          writes.push(data);
          return true;
        }),
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      // Program that throws an error (simulating interruption)
      const program = Effect.gen(function* () {
        yield* Effect.sleep('10 millis');
        yield* Effect.fail(new Error('interrupted'));
        return 'should not reach here';
      });

      const withTerminal = withTerminalLifecycle(program, {
        rawMode: true,
        hideCursor: true,
      });

      const result = await Effect.runPromise(Effect.either(withTerminal));

      // Program was interrupted/failed
      expect(result._tag).toBe('Left');

      // Terminal state was restored despite interruption
      expect(setRawModeMock).toHaveBeenCalled();
      expect(writes).toContain('\x1b[?25l'); // Hide cursor
      expect(writes).toContain('\x1b[?25h'); // Show cursor

      // Restore
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        configurable: true,
      });
    });

    test('restoreTerminalState is idempotent', () => {
      // Call multiple times - should not throw
      restoreTerminalState();
      restoreTerminalState();
      restoreTerminalState();

      // No expectations - just verifying it doesn't crash
    });
  });
});
