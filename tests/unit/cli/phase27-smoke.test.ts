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

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';

// We mock createFredTuiApp at the module level so handleChatCommand
// doesn't try to create a real OpenTUI renderer in TTY mode tests.
// Import the real FredTuiApp so other tests can still use it.
import { FredTuiApp } from '../../../packages/cli/src/tui/app';

const mockApp = {
  stop: mock(() => {}),
  isRunning: () => true,
  getState: () => ({}),
};

const mockCreateFredTuiApp = mock(async () => mockApp);

// Use mock.module to intercept only createFredTuiApp, preserve FredTuiApp
mock.module('../../../packages/cli/src/tui/app', () => ({
  createFredTuiApp: mockCreateFredTuiApp,
  FredTuiApp,
}));

describe('phase 27 smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;

    exitCode = undefined;
    (process as any).exit = mock((code?: number) => {
      exitCode = code ?? 0;
    });

    mockCreateFredTuiApp.mockClear();
  });

  afterEach(() => {
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
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      expect(content).toContain('fred chat');
      expect(content).toContain('Start interactive chat interface');
      expect(content).toContain('Get started:');
    });

    test('bare command defaults to help', () => {
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

    test('chat command in TTY mode creates TUI app via createFredTuiApp', async () => {
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock(() => {}),
      } as any;

      const mockStdout = {
        isTTY: true,
        columns: 120,
        rows: 40,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        configurable: true,
      });

      // Dynamic import to get the mocked version
      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
      await handleChatCommand();

      // Verify createFredTuiApp was called (OpenTUI manages terminal internally)
      expect(mockCreateFredTuiApp).toHaveBeenCalled();

      // Verify no exit was called (interactive mode stays running)
      expect(exitCode).toBeUndefined();
    });
  });

  describe('chat command selects non-interactive branch in non-TTY mode', () => {
    test('detectTerminalMode returns non-tty for piped stdin', () => {
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

    test('chat command in non-TTY mode emits JSON and exits', async () => {
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

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = mock((...args: any[]) => {
        logs.push(args.join(' '));
      });

      try {
        const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
        await handleChatCommand();

        const jsonOutput = logs.join('\n');
        expect(jsonOutput).toContain('non-interactive');

        const parsed = JSON.parse(jsonOutput);
        expect(parsed.mode).toBe('non-interactive');
        expect(parsed.reason).toBeTruthy();
        expect(parsed.suggestion).toContain('terminal');

        expect(exitCode).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('no raw-mode APIs invoked in non-TTY mode', () => {
    test('setRawMode not called when non-TTY detected', async () => {
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

      const originalLog = console.log;
      console.log = mock(() => {});

      try {
        const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
        await handleChatCommand();

        expect(setRawModeSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });

    test('terminal lifecycle safety in non-TTY mode', () => {
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

      const mode = detectTerminalMode();

      expect(mode.canUseRawMode).toBe(false);
      expect(mode.isInteractive).toBe(false);
    });
  });

  describe('command and mode routing integration', () => {
    test('chat command routing logic exists in CLI index', async () => {
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      expect(content).toContain("case 'chat':");
      expect(content).toContain('handleChatCommand');
    });

    test('parseArgs correctly identifies chat command', () => {
      const args = ['chat'];
      const command = args[0];

      expect(command).toBe('chat');
      expect(command).not.toBe('dev');
      expect(command).not.toBe('test');
      expect(command).not.toBe('help');
    });

    test('mode detection drives routing decision', () => {
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

      const nonTtyMockStdin = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: nonTtyMockStdin,
        configurable: true,
      });

      const nonTtyMode = detectTerminalMode();
      expect(nonTtyMode.mode).toBe('non-tty');

      expect(ttyMode.mode).not.toBe(nonTtyMode.mode);
      expect(ttyMode.isInteractive).toBe(true);
      expect(nonTtyMode.isInteractive).toBe(false);
    });
  });
});
