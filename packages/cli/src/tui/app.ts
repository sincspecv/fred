/**
 * Top-level TUI app wiring
 *
 * Integrates state model, keymap, and layout for the Fred chat shell.
 * Provides a framework-agnostic app structure that can be adapted to OpenTUI later.
 */

import type { TuiState } from './state.js';
import { createInitialTuiState } from './state.js';
import { createKeymap, parseKeyEvent, handleKeyEvent } from './keymap.js';
import { renderAllPanes, STARTUP_HINT } from './layout.js';

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

/**
 * TUI app instance
 */
export class FredTuiApp {
  private state: TuiState;
  private keymap: ReturnType<typeof createKeymap>;
  private config: Required<TuiAppConfig>;
  private events: TuiAppEvents;
  private running: boolean = false;

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
    }
  }

  /**
   * Render current state to terminal (abstracted for testing)
   */
  render(): string[] {
    const panes = renderAllPanes(
      this.state,
      this.config.terminalWidth,
      this.config.terminalHeight
    );

    // Simple text-based rendering for framework-agnostic implementation
    const output: string[] = [];

    // Add pane content (simplified layout)
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
   * Start the TUI app
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Show startup hint if enabled
    if (this.config.showStartupHint) {
      console.log(STARTUP_HINT);
    }

    // Initial render
    this.events.onStateChange?.(this.state);
  }

  /**
   * Stop the TUI app
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
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
