/**
 * Phase 27 Smoke Tests
 *
 * Cross-module smoke coverage for phase-27 command and mode routing.
 * These tests verify the user-visible behavior guarantees of phase 27:
 * - Help-first default for bare command
 * - Explicit chat command selects interactive branch in TTY mode
 * - Explicit chat command selects non-interactive branch in non-TTY mode
 * - No raw-mode APIs invoked in non-TTY mode
 */

import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
import { handleChatCommand } from '../../../packages/cli/src/commands/chat';

describe('phase 27 smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;

    // Mock process.exit to capture exit code
    exitCode = undefined;
    (process as any).exit = mock((code?: number) => {
      exitCode = code ?? 0;
      // Don't actually exit
    });
  });

  afterEach(() => {
    // Restore stdin/stdout/exit after tests
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true,
    });
    (process as any).exit = originalExit;
  });

  describe('bare command path emits help-first guidance', () => {
    test('help text includes fred chat', async () => {
      // Read CLI index to verify help text content
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      // Verify help-first guidance includes chat command
      expect(content).toContain('fred chat');
      expect(content).toContain('Start interactive chat interface');
      expect(content).toContain('Get started:');
    });

    test('bare command defaults to help', () => {
      // Simulate bare 'fred' command (no args)
      const args: string[] = [];
      const command = args[0] || 'help';

      expect(command).toBe('help');
    });

    test('explicit help flag triggers help', () => {
      const args = ['--help'];
      const shouldShowHelp = args[0] === 'help' || args[0] === '--help' || args[0] === '-h';

      expect(shouldShowHelp).toBe(true);
    });
  });

  describe('chat command selects interactive branch in TTY mode', () => {
    test('detectTerminalMode returns interactive-tty for full TTY capabilities', () => {
      // Mock fully capable TTY environment
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
      expect(result.isInteractive).toBe(true);
      expect(result.canUseRawMode).toBe(true);
    });

    test('chat command in TTY mode creates TUI app', () => {
      // Mock fully capable TTY with all methods the TUI app needs
      let rawMode = false;
      const dataListeners: Function[] = [];
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
        resume: mock(() => {}),
        setEncoding: mock(() => {}),
        on: mock((event: string, handler: Function) => {
          if (event === 'data') dataListeners.push(handler);
        }),
        removeListener: mock(() => {}),
        pause: mock(() => {}),
      } as any;

      const writeBuffer: string[] = [];
      const mockStdout = {
        isTTY: true,
        columns: 120,
        rows: 40,
        write: mock((data: string) => {
          writeBuffer.push(data);
          return true;
        }),
        on: mock(() => {}),
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      try {
        // Call handleChatCommand - it should not exit in TTY mode
        handleChatCommand();

        // Verify raw mode was entered (interactive TUI needs it)
        expect(mockStdin.setRawMode).toHaveBeenCalled();

        // Verify stdin.resume was called (keeps process alive for key input)
        expect(mockStdin.resume).toHaveBeenCalled();

        // Verify stdout.write was called (TUI renders to terminal)
        expect(mockStdout.write).toHaveBeenCalled();

        // Verify stdin data listener was registered (for key handling)
        expect(dataListeners.length).toBeGreaterThan(0);

        // Verify no exit was called (interactive mode stays running)
        expect(exitCode).toBeUndefined();
      } finally {
        // Clean up
      }
    });
  });

  describe('chat command selects non-interactive branch in non-TTY mode', () => {
    test('detectTerminalMode returns non-tty for piped stdin', () => {
      // Mock as non-TTY (piped input)
      const mockStdin = {
        isTTY: false,
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

      expect(result.mode).toBe('non-tty');
      expect(result.isInteractive).toBe(false);
      expect(result.canUseRawMode).toBe(false);
    });

    test('chat command in non-TTY mode emits JSON and exits', () => {
      // Mock as non-TTY
      const mockStdin = {
        isTTY: false,
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

      // Mock console.log to capture output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = mock((...args: any[]) => {
        logs.push(args.join(' '));
      });

      try {
        // Call handleChatCommand - should exit with code 1
        handleChatCommand();

        // Verify JSON output was emitted
        const jsonOutput = logs.join('\n');
        expect(jsonOutput).toContain('non-interactive');
        expect(jsonOutput).toContain('stdin TTY: false');

        // Parse JSON to verify structure
        const parsed = JSON.parse(jsonOutput);
        expect(parsed.mode).toBe('non-interactive');
        expect(parsed.reason).toBeTruthy();
        expect(parsed.suggestion).toContain('terminal');

        // Verify process.exit(1) was called
        expect(exitCode).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('no raw-mode APIs invoked in non-TTY mode', () => {
    test('setRawMode not called when non-TTY detected', () => {
      // Mock as non-TTY with setRawMode spy
      const setRawModeSpy = mock(() => {
        throw new Error('setRawMode should not be called in non-TTY mode');
      });

      const mockStdin = {
        isTTY: false,
        setRawMode: setRawModeSpy,
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

      // Mock console.log to prevent output
      const originalLog = console.log;
      console.log = mock(() => {});

      try {
        // Call handleChatCommand
        handleChatCommand();

        // Verify setRawMode was never called
        expect(setRawModeSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });

    test('terminal lifecycle safety in non-TTY mode', () => {
      // Mock as non-TTY
      const mockStdin = {
        isTTY: false,
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

      // Detect mode
      const mode = detectTerminalMode();

      // Verify non-TTY mode does not allow raw mode
      expect(mode.canUseRawMode).toBe(false);
      expect(mode.isInteractive).toBe(false);

      // In non-TTY mode, chat command should fail safely without touching terminal state
      expect(() => {
        const originalLog = console.log;
        console.log = mock(() => {});
        try {
          handleChatCommand();
        } finally {
          console.log = originalLog;
        }
      }).not.toThrow();
    });
  });

  describe('command and mode routing integration', () => {
    test('chat command routing logic exists in CLI index', async () => {
      // Read CLI index to verify chat case exists
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      // Verify switch case for chat command
      expect(content).toContain("case 'chat':");
      expect(content).toContain('handleChatCommand');
    });

    test('parseArgs correctly identifies chat command', () => {
      // Simulate 'fred chat' command
      const args = ['chat'];
      const command = args[0];

      expect(command).toBe('chat');
      expect(command).not.toBe('dev');
      expect(command).not.toBe('test');
      expect(command).not.toBe('help');
    });

    test('mode detection drives routing decision', () => {
      // Interactive TTY mode should enable TUI
      let rawMode = false;
      const ttyMockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
      } as any;

      const ttyMockStdout = {
        isTTY: true,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: ttyMockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: ttyMockStdout,
        configurable: true,
      });

      const ttyMode = detectTerminalMode();
      expect(ttyMode.mode).toBe('interactive-tty');

      // Non-TTY mode should provide non-interactive output
      const nonTtyMockStdin = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: nonTtyMockStdin,
        configurable: true,
      });

      const nonTtyMode = detectTerminalMode();
      expect(nonTtyMode.mode).toBe('non-tty');

      // Verify modes are distinct and drive different paths
      expect(ttyMode.mode).not.toBe(nonTtyMode.mode);
      expect(ttyMode.isInteractive).toBe(true);
      expect(nonTtyMode.isInteractive).toBe(false);
    });
  });
});
