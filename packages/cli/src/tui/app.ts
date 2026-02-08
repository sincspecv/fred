/**
 * Top-level TUI app wiring
 *
 * Integrates state model, keymap, and layout with OpenTUI renderer.
 * OpenTUI manages alternate screen, raw mode, cursor, and cleanup.
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  type KeyEvent,
  type CliRenderer,
} from '@opentui/core';
import type { TuiState, FocusablePaneId } from './state.js';
import { createInitialTuiState, submitInput } from './state.js';
import { mapKeyToAction, applyKeyAction, handleKeyEvent } from './keymap.js';
import {
  renderSidebarContent,
  renderTranscriptContent,
  renderStatusContent,
  DEFAULT_LAYOUT,
} from './layout.js';

/**
 * TUI app configuration
 */
export interface TuiAppConfig {
  showStartupHint?: boolean;
}

/**
 * TUI app lifecycle events
 */
export interface TuiAppEvents {
  onStateChange?: (state: TuiState) => void;
  onSubmit?: (text: string) => void;
  onQuit?: () => void;
  onError?: (error: Error) => void;
}

/**
 * TUI app instance backed by OpenTUI
 */
export class FredTuiApp {
  private state: TuiState;
  private renderer: CliRenderer;
  private events: TuiAppEvents;
  private running: boolean = false;

  // OpenTUI component references
  private sidebarTitle!: TextRenderable;
  private sidebarItems!: ScrollBoxRenderable;
  private transcriptContent!: ScrollBoxRenderable;
  private inputPrompt!: TextRenderable;
  private inputText!: TextRenderable;
  private statusText!: TextRenderable;
  private sidebarBox!: BoxRenderable;
  private transcriptBox!: BoxRenderable;
  private inputBar!: BoxRenderable;

  private constructor(renderer: CliRenderer, events: TuiAppEvents = {}) {
    this.state = createInitialTuiState();
    this.renderer = renderer;
    this.events = events;
  }

  /**
   * Create app with CLI renderer (production)
   */
  static async create(events: TuiAppEvents = {}): Promise<FredTuiApp> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
    });
    const app = new FredTuiApp(renderer, events);
    app.buildComponentTree();
    app.registerKeyboardHandler();
    app.syncStateToUI();
    app.running = true;
    return app;
  }

  /**
   * Create app with injected renderer (testing)
   */
  static createWithRenderer(renderer: CliRenderer, events: TuiAppEvents = {}): FredTuiApp {
    const app = new FredTuiApp(renderer, events);
    app.buildComponentTree();
    app.registerKeyboardHandler();
    app.syncStateToUI();
    app.running = true;
    return app;
  }

  /**
   * Build the OpenTUI component tree
   *
   * root (Box, column, 100%x100%)
   * +-- mainArea (Box, row, flexGrow: 1)
   * |   +-- sidebar (Box, width: 30, border: rounded)
   * |   |   +-- sidebarTitle (Text, "[Sessions]")
   * |   |   +-- sidebarItems (ScrollBox, flexGrow: 1)
   * |   +-- transcript (Box, flexGrow: 1, border: rounded)
   * |       +-- transcriptContent (ScrollBox, flexGrow: 1)
   * +-- inputBar (Box, height: 3, border: single)
   * |   +-- prompt (Text, "> ")
   * |   +-- inputText (Text, flexGrow: 1)
   * +-- statusBar (Box, height: 1, inverse bg)
   *     +-- statusText (Text)
   */
  private buildComponentTree(): void {
    const r = this.renderer;

    // Root container
    const root = new BoxRenderable(r, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
    });

    // Main area (sidebar + transcript)
    const mainArea = new BoxRenderable(r, {
      id: 'main-area',
      flexDirection: 'row',
      flexGrow: 1,
    });

    // Sidebar
    this.sidebarBox = new BoxRenderable(r, {
      id: 'sidebar',
      width: DEFAULT_LAYOUT.sidebarWidth,
      border: true,
      borderStyle: 'rounded',
      flexDirection: 'column',
    });

    this.sidebarTitle = new TextRenderable(r, {
      id: 'sidebar-title',
      content: '[Sessions]',
      attributes: TextAttributes.BOLD,
      fg: '#00FFFF',
    });

    this.sidebarItems = new ScrollBoxRenderable(r, {
      id: 'sidebar-items',
      flexGrow: 1,
    });

    this.sidebarBox.add(this.sidebarTitle);
    this.sidebarBox.add(this.sidebarItems);

    // Transcript
    this.transcriptBox = new BoxRenderable(r, {
      id: 'transcript',
      flexGrow: 1,
      border: true,
      borderStyle: 'rounded',
      flexDirection: 'column',
    });

    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
    });

    this.transcriptBox.add(this.transcriptContent);

    mainArea.add(this.sidebarBox);
    mainArea.add(this.transcriptBox);

    // Input bar
    this.inputBar = new BoxRenderable(r, {
      id: 'input-bar',
      height: DEFAULT_LAYOUT.inputHeight,
      border: true,
      borderStyle: 'single',
      flexDirection: 'row',
      alignItems: 'center',
    });

    this.inputPrompt = new TextRenderable(r, {
      id: 'input-prompt',
      content: '> ',
      attributes: TextAttributes.BOLD,
      fg: '#00FF00',
    });

    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: '',
      flexGrow: 1,
    });

    this.inputBar.add(this.inputPrompt);
    this.inputBar.add(this.inputText);

    // Status bar
    const statusBar = new BoxRenderable(r, {
      id: 'status-bar',
      height: DEFAULT_LAYOUT.statusHeight,
      backgroundColor: '#444444',
    });

    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: '',
      attributes: TextAttributes.INVERSE,
    });

    statusBar.add(this.statusText);

    // Compose tree
    root.add(mainArea);
    root.add(this.inputBar);
    root.add(statusBar);

    r.root.add(root);
  }

  /**
   * Register keyboard handler on the renderer
   */
  private registerKeyboardHandler(): void {
    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      if (!this.running) return;
      this.processKey(key);
    });
  }

  /**
   * Process a key event through the state machine
   */
  processKey(key: KeyEvent): void {
    const action = mapKeyToAction(key, this.state);

    if (action.type === 'quit') {
      this.stop();
      return;
    }

    if (action.type === 'submit') {
      const { state: newState, submittedText } = submitInput(this.state);
      this.state = newState;
      this.events.onStateChange?.(this.state);
      this.events.onSubmit?.(submittedText);
      this.syncStateToUI();
      return;
    }

    const newState = applyKeyAction(this.state, action);
    this.state = newState;
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Push current state to OpenTUI renderables
   */
  private syncStateToUI(): void {
    const r = this.renderer;

    // Sidebar content
    const sidebarContent = renderSidebarContent(
      this.state,
      this.state.focusedPane === 'sidebar'
    );

    // Clear and re-populate sidebar items
    // Remove existing children first
    const existingSidebarChildren: TextRenderable[] = [];
    // We track items by rebuilding each sync
    this.sidebarItems.destroy();
    this.sidebarItems = new ScrollBoxRenderable(r, {
      id: 'sidebar-items',
      flexGrow: 1,
    });
    // Skip first line (title) and blank line from sidebarContent
    const itemLines = sidebarContent.lines.slice(2);
    for (let i = 0; i < itemLines.length; i++) {
      const text = new TextRenderable(r, {
        id: `sidebar-item-${i}`,
        content: itemLines[i],
        fg: this.state.focusedPane === 'sidebar' ? '#FFFFFF' : '#888888',
      });
      this.sidebarItems.add(text);
    }
    this.sidebarBox.add(this.sidebarItems);

    // Sidebar title styling based on focus
    this.sidebarTitle = this.rebuildText(
      this.sidebarTitle,
      'sidebar-title',
      '[Sessions]',
      this.state.focusedPane === 'sidebar' ? '#00FFFF' : '#888888',
      TextAttributes.BOLD,
    );

    // Transcript content
    const transcriptData = renderTranscriptContent(
      this.state,
      this.state.focusedPane === 'transcript'
    );

    this.transcriptContent.destroy();
    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
    });
    for (let i = 0; i < transcriptData.lines.length; i++) {
      const line = transcriptData.lines[i];
      const isRoleLabel = line.endsWith(':') && (line === 'user:' || line === 'assistant:');
      const text = new TextRenderable(r, {
        id: `transcript-line-${i}`,
        content: line,
        fg: isRoleLabel ? '#00FFFF' : (this.state.focusedPane === 'transcript' ? '#FFFFFF' : '#CCCCCC'),
        attributes: isRoleLabel ? TextAttributes.BOLD : 0,
      });
      this.transcriptContent.add(text);
    }
    this.transcriptBox.add(this.transcriptContent);

    // Input text
    this.inputText.destroy();
    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: this.state.input.text || (this.state.focusedPane === 'input' ? '' : 'Type a message...'),
      flexGrow: 1,
      fg: this.state.input.text ? '#FFFFFF' : '#666666',
    });
    this.inputBar.add(this.inputText);

    // Input prompt styling based on focus
    this.inputPrompt.destroy();
    this.inputPrompt = new TextRenderable(r, {
      id: 'input-prompt',
      content: '> ',
      attributes: this.state.focusedPane === 'input' ? TextAttributes.BOLD : 0,
      fg: this.state.focusedPane === 'input' ? '#00FF00' : '#888888',
    });
    this.inputBar.add(this.inputPrompt);

    // Status bar
    const statusData = renderStatusContent(this.state);
    this.statusText.destroy();
    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: ` ${statusData.lines[0]} `,
      attributes: TextAttributes.INVERSE,
    });
    const statusBar = r.root.getRenderable('root')?.getRenderable('status-bar');
    if (statusBar) {
      statusBar.add(this.statusText);
    }

    // Border highlighting for focused pane
    this.updateBorderFocus();
  }

  /**
   * Helper: rebuild a TextRenderable in place
   */
  private rebuildText(
    existing: TextRenderable,
    id: string,
    content: string,
    fg: string,
    attributes: number,
  ): TextRenderable {
    existing.destroy();
    const newText = new TextRenderable(this.renderer, {
      id,
      content,
      fg,
      attributes,
    });
    this.sidebarBox.add(newText);
    return newText;
  }

  /**
   * Update border colors to indicate focus
   */
  private updateBorderFocus(): void {
    const focusColor = '#7aa2f7';
    const dimColor = '#444444';

    // We can't dynamically change border color on BoxRenderable after creation
    // without rebuilding, so we rely on the content styling to indicate focus.
    // The title/text color changes above provide visual focus indication.
  }

  /**
   * Get current state (for testing)
   */
  getState(): TuiState {
    return this.state;
  }

  /**
   * Get the renderer (for testing)
   */
  getRenderer(): CliRenderer {
    return this.renderer;
  }

  /**
   * Stop the TUI app and restore terminal
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.destroy();
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
export async function createFredTuiApp(
  events?: TuiAppEvents
): Promise<FredTuiApp> {
  return FredTuiApp.create(events);
}
