/**
 * Top-level TUI app wiring
 *
 * Integrates state model, keymap, and layout for the Fred chat shell.
 * Handles raw stdin reading, ANSI terminal rendering, and the interactive loop.
 */

import type { TuiState, PaneId, FocusablePaneId } from './state.js';
import { createInitialTuiState } from './state.js';
import { createKeymap, parseKeyEvent, handleKeyEvent } from './keymap.js';
import {
  renderAllPanes,
  calculatePaneLayouts,
  STARTUP_HINT,
  DEFAULT_LAYOUT,
  type PaneContent,
} from './layout.js';

/**
 * TUI app configuration
 */
export interface TuiAppConfig {
  terminalWidth?: number;
  terminalHeight?: number;
  showStartupHint?: boolean;
}

/**
 * TUI app lifecycle events
 */
export interface TuiAppEvents {
  onStateChange?: (state: TuiState) => void;
  onQuit?: () => void;
  onError?: (error: Error) => void;
}

// ANSI escape helpers
const ESC = '\x1b';
const CSI = `${ESC}[`;
const ansi = {
  clearScreen: `${CSI}2J`,
  moveTo: (row: number, col: number) => `${CSI}${row + 1};${col + 1}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  inverse: `${CSI}7m`,
  reset: `${CSI}0m`,
  eraseToEOL: `${CSI}K`,
  fg: {
    cyan: `${CSI}36m`,
    yellow: `${CSI}33m`,
    green: `${CSI}32m`,
    gray: `${CSI}90m`,
    white: `${CSI}37m`,
  },
  bg: {
    darkGray: `${CSI}48;5;236m`,
  },
};

/**
 * TUI app instance
 */
export class FredTuiApp {
  private state: TuiState;
  private keymap: ReturnType<typeof createKeymap>;
  private config: Required<TuiAppConfig>;
  private events: TuiAppEvents;
  private running: boolean = false;
  private stdinHandler: ((data: Buffer) => void) | null = null;

  constructor(config: TuiAppConfig = {}, events: TuiAppEvents = {}) {
    this.state = createInitialTuiState();
    this.keymap = createKeymap();
    this.config = {
      terminalWidth: config.terminalWidth ?? 120,
      terminalHeight: config.terminalHeight ?? 40,
      showStartupHint: config.showStartupHint ?? true,
    };
    this.events = events;
  }

  /**
   * Get current state (for testing and external access)
   */
  getState(): TuiState {
    return this.state;
  }

  /**
   * Process key input
   */
  processKey(rawKey: string): void {
    const event = parseKeyEvent(rawKey);
    const { state: newState, shouldQuit } = handleKeyEvent(this.state, event);

    this.state = newState;
    this.events.onStateChange?.(this.state);

    if (shouldQuit) {
      this.stop();
      return;
    }

    // Re-render after state change
    this.renderToTerminal();
  }

  /**
   * Render current state as string lines (for testing)
   */
  render(): string[] {
    const panes = renderAllPanes(
      this.state,
      this.config.terminalWidth,
      this.config.terminalHeight
    );

    const output: string[] = [];
    output.push('=== Sidebar ===');
    output.push(...panes.sidebar.lines);
    output.push('');
    output.push('=== Transcript ===');
    output.push(...panes.transcript.lines);
    output.push('');
    output.push('=== Input ===');
    output.push(...panes.input.lines);
    output.push('');
    output.push('=== Status ===');
    output.push(...panes.status.lines);

    return output;
  }

  /**
   * Render current state to the real terminal using ANSI escape sequences
   */
  renderToTerminal(): void {
    const w = this.config.terminalWidth;
    const h = this.config.terminalHeight;
    const panes = renderAllPanes(this.state, w, h);
    const layouts = calculatePaneLayouts(w, h);

    const sidebarW = DEFAULT_LAYOUT.sidebarWidth;
    const mainW = w - sidebarW;
    const inputH = DEFAULT_LAYOUT.inputHeight;
    const statusH = DEFAULT_LAYOUT.statusHeight;
    const bodyH = h - inputH - statusH;

    let buf = ansi.hideCursor;

    // Draw sidebar (left column, rows 0..bodyH-1)
    const isSidebarFocused = this.state.focusedPane === 'sidebar';
    for (let row = 0; row < bodyH; row++) {
      buf += ansi.moveTo(row, 0);
      if (row < panes.sidebar.lines.length) {
        const line = panes.sidebar.lines[row];
        const display = truncPad(line, sidebarW - 1);
        if (isSidebarFocused && row === 0) {
          buf += `${ansi.bold}${ansi.fg.cyan}${display}${ansi.reset}`;
        } else {
          buf += `${ansi.fg.gray}${display}${ansi.reset}`;
        }
      } else {
        buf += ' '.repeat(sidebarW - 1);
      }
      // Draw vertical separator
      buf += `${ansi.dim}│${ansi.reset}`;
    }

    // Draw transcript (right column, rows 0..bodyH-1)
    const isTranscriptFocused = this.state.focusedPane === 'transcript';
    for (let row = 0; row < bodyH; row++) {
      buf += ansi.moveTo(row, sidebarW);
      if (row < panes.transcript.lines.length) {
        const line = panes.transcript.lines[row];
        const display = truncPad(line, mainW);
        if (isTranscriptFocused) {
          buf += `${ansi.fg.white}${display}${ansi.reset}`;
        } else {
          buf += `${ansi.dim}${display}${ansi.reset}`;
        }
      } else {
        buf += ' '.repeat(mainW);
      }
    }

    // Draw horizontal separator above input
    buf += ansi.moveTo(bodyH, 0);
    buf += `${ansi.dim}${'─'.repeat(w)}${ansi.reset}`;

    // Draw input bar
    const isInputFocused = this.state.focusedPane === 'input';
    const inputRow = bodyH + 1;
    buf += ansi.moveTo(inputRow, 0);
    const prompt = isInputFocused ? `${ansi.bold}${ansi.fg.green}> ${ansi.reset}` : `${ansi.dim}> ${ansi.reset}`;
    const inputText = this.state.input.text || (isInputFocused ? '' : 'Type a message...');
    const inputDisplay = isInputFocused ? inputText : `${ansi.dim}${inputText}${ansi.reset}`;
    buf += `${prompt}${inputDisplay}${ansi.eraseToEOL}`;

    // Draw status bar at very bottom
    const statusRow = h - 1;
    buf += ansi.moveTo(statusRow, 0);
    const focusLabel = this.state.focusedPane.charAt(0).toUpperCase() + this.state.focusedPane.slice(1);
    const statusText = ` Focus: ${focusLabel}  │  Tab: cycle  │  Esc: quit `;
    buf += `${ansi.inverse}${truncPad(statusText, w)}${ansi.reset}`;

    // Position cursor at input if focused
    if (isInputFocused) {
      buf += ansi.moveTo(inputRow, 2 + this.state.input.cursorPosition);
      buf += ansi.showCursor;
    }

    process.stdout.write(buf);
  }

  /**
   * Start the TUI app with interactive terminal loop
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Enter raw mode
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    if (typeof process.stdin.setEncoding === 'function') {
      process.stdin.setEncoding('utf8');
    }

    // Show startup hint briefly, then render
    if (this.config.showStartupHint) {
      process.stdout.write(ansi.clearScreen + ansi.moveTo(0, 0));
      process.stdout.write(STARTUP_HINT + '\n');
      // Small delay to show hint, then render full UI
      setTimeout(() => {
        this.renderToTerminal();
      }, 300);
    } else {
      process.stdout.write(ansi.clearScreen);
      this.renderToTerminal();
    }

    // Read stdin character by character
    this.stdinHandler = (data: Buffer) => {
      if (!this.running) return;
      const key = data.toString();
      this.processKey(key);
    };
    process.stdin.on('data', this.stdinHandler);

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.config.terminalWidth = process.stdout.columns || 120;
      this.config.terminalHeight = process.stdout.rows || 40;
      this.renderToTerminal();
    });
  }

  /**
   * Stop the TUI app and restore terminal
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Remove stdin handler
    if (this.stdinHandler) {
      process.stdin.removeListener('data', this.stdinHandler);
      this.stdinHandler = null;
    }

    // Restore terminal state
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    process.stdin.pause();

    // Show cursor and clear screen
    process.stdout.write(ansi.showCursor + ansi.clearScreen + ansi.moveTo(0, 0));

    this.events.onQuit?.();
  }

  /**
   * Check if app is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Truncate or pad a string to exact width
 */
function truncPad(str: string, width: number): string {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  if (stripped.length >= width) {
    // Truncate the raw string (imperfect with ANSI but workable)
    return str.slice(0, width);
  }
  return str + ' '.repeat(width - stripped.length);
}

/**
 * Create and start TUI app (convenience function)
 */
export function createFredTuiApp(
  config?: TuiAppConfig,
  events?: TuiAppEvents
): FredTuiApp {
  const app = new FredTuiApp(config, events);
  app.start();
  return app;
}
