/**
 * TUI layout composition
 *
 * Defines the multi-pane shell structure:
 * - Left sidebar pane
 * - Main transcript pane
 * - Bottom input bar pane
 * - Bottom status bar (display-only, never focusable)
 *
 * This module provides a framework-agnostic layout specification.
 * Actual rendering is abstracted to allow OpenTUI integration later.
 */

import type { TuiState, PaneId } from './state.js';

/**
 * Pane layout specification
 */
export interface PaneLayout {
  id: PaneId;
  focusable: boolean;
  region: {
    x: number;
    y: number;
    width: number | 'auto';
    height: number | 'auto';
  };
}

/**
 * Layout configuration for the TUI shell
 */
export interface LayoutConfig {
  sidebarWidth: number;
  inputHeight: number;
  statusHeight: number;
}

/**
 * Default layout configuration
 */
export const DEFAULT_LAYOUT: LayoutConfig = {
  sidebarWidth: 30,
  inputHeight: 3,
  statusHeight: 1,
};

/**
 * Calculate pane layouts based on terminal dimensions
 */
export function calculatePaneLayouts(
  terminalWidth: number,
  terminalHeight: number,
  config: LayoutConfig = DEFAULT_LAYOUT
): PaneLayout[] {
  const { sidebarWidth, inputHeight, statusHeight } = config;

  // Calculate main content area dimensions
  const mainWidth = terminalWidth - sidebarWidth;
  const mainHeight = terminalHeight - inputHeight - statusHeight;

  return [
    // Sidebar: left column, full height minus input/status
    {
      id: 'sidebar',
      focusable: true,
      region: {
        x: 0,
        y: 0,
        width: sidebarWidth,
        height: mainHeight,
      },
    },
    // Transcript: right column, full height minus input/status
    {
      id: 'transcript',
      focusable: true,
      region: {
        x: sidebarWidth,
        y: 0,
        width: mainWidth,
        height: mainHeight,
      },
    },
    // Input: bottom, full width, above status
    {
      id: 'input',
      focusable: true,
      region: {
        x: 0,
        y: mainHeight,
        width: terminalWidth,
        height: inputHeight,
      },
    },
    // Status: very bottom, full width, never focusable
    {
      id: 'status',
      focusable: false,
      region: {
        x: 0,
        y: mainHeight + inputHeight,
        width: terminalWidth,
        height: statusHeight,
      },
    },
  ];
}

/**
 * Get pane layout by ID
 */
export function getPaneLayout(
  layouts: PaneLayout[],
  paneId: PaneId
): PaneLayout | undefined {
  return layouts.find((layout) => layout.id === paneId);
}

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
 * Generate input bar content
 */
export function renderInputContent(state: TuiState, focused: boolean): PaneContent {
  const { text, cursorPosition } = state.input;

  const prompt = '> ';
  const displayText = text || '';

  // Show cursor position if focused
  const cursorIndicator = focused ? `[${cursorPosition}]` : '';

  return {
    lines: [
      '',
      prompt + displayText + cursorIndicator,
      '',
    ],
    focusIndicator: focused ? '*' : undefined,
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

/**
 * Main TUI app component (framework-agnostic structure)
 */
export interface FredTuiAppProps {
  state: TuiState;
  onKeyPress?: (key: string) => void;
}

/**
 * Render all panes for the current state
 */
export function renderAllPanes(
  state: TuiState,
  terminalWidth: number,
  terminalHeight: number
): Record<PaneId, PaneContent> {
  return {
    sidebar: renderSidebarContent(state, state.focusedPane === 'sidebar'),
    transcript: renderTranscriptContent(state, state.focusedPane === 'transcript'),
    input: renderInputContent(state, state.focusedPane === 'input'),
    status: renderStatusContent(state),
  };
}
