/**
 * TUI layout content providers
 *
 * Provides content data for each pane. Actual layout and rendering
 * is handled by OpenTUI's Yoga flexbox engine in app.ts.
 */

import type { TuiState } from './state.js';

/**
 * Default layout configuration
 */
export const DEFAULT_LAYOUT = {
  sidebarWidth: 30,
  inputHeight: 3,
  statusHeight: 1,
};

/**
 * Render content for a pane (framework-agnostic content model)
 */
export interface PaneContent {
  lines: string[];
  focusIndicator?: string;
}

/**
 * Generate sidebar content
 */
export function renderSidebarContent(state: TuiState, focused: boolean): PaneContent {
  const lines = ['[Sessions]', '', ...(state.sidebar.items.length > 0 ? state.sidebar.items : ['(empty)'])];

  return {
    lines,
    focusIndicator: focused ? '>' : undefined,
  };
}

/**
 * Generate transcript content
 */
export function renderTranscriptContent(state: TuiState, focused: boolean): PaneContent {
  const { messages, viewport } = state.transcript;

  if (messages.length === 0) {
    return {
      lines: ['', 'Fred AI Framework', '', 'Type a message to begin...'],
      focusIndicator: focused ? '>' : undefined,
    };
  }

  // Apply viewport scrolling
  const lines = messages.flatMap((msg) => [
    `${msg.role}:`,
    msg.content,
    '',
  ]);

  const visibleLines = lines.slice(
    viewport.scrollOffset,
    viewport.scrollOffset + viewport.visibleLines
  );

  return {
    lines: visibleLines,
    focusIndicator: focused ? '>' : undefined,
  };
}

/**
 * Generate status bar content
 */
export function renderStatusContent(state: TuiState): PaneContent {
  const focusedPane = state.focusedPane;
  const statusText = `Focus: ${focusedPane} | Tab: cycle focus | Esc: quit`;

  return {
    lines: [statusText],
  };
}

/**
 * Startup hint displayed before entering full shell
 */
export const STARTUP_HINT = 'Starting Fred chat... Press Tab to cycle focus, Esc to quit.';
