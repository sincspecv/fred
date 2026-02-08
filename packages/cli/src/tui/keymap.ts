/**
 * Keyboard event handling and key bindings
 *
 * Implements focus cycle and navigation rules:
 * - Tab: cycle focus forward with wraparound
 * - Shift+Tab: cycle focus backward with wraparound
 * - Status bar excluded from focus order
 * - Transcript: Up/Down and PgUp/PgDn for scrolling
 * - Input: Up/Down for history when empty, cursor movement otherwise
 */

import type { TuiState } from './state.js';
import {
  nextFocusablePane,
  prevFocusablePane,
  setFocusedPane,
  scrollTranscript,
  navigateInputHistory,
  updateInputText,
} from './state.js';

/**
 * Key event representation
 */
export interface KeyEvent {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Parse raw key input into KeyEvent
 */
export function parseKeyEvent(raw: string): KeyEvent {
  // Basic key parsing (can be enhanced with full ANSI sequence support)
  // Control characters start with ASCII codes < 32
  const isCtrl = raw.length > 0 && raw.charCodeAt(0) < 32 && raw !== '\t' && raw !== '\n' && raw !== '\r';

  return {
    key: raw,
    shift: false,
    ctrl: isCtrl,
    alt: false,
    meta: false,
  };
}

/**
 * Key action types
 */
export type KeyAction =
  | { type: 'focus-next' }
  | { type: 'focus-prev' }
  | { type: 'scroll-up'; lines: number }
  | { type: 'scroll-down'; lines: number }
  | { type: 'history-up' }
  | { type: 'history-down' }
  | { type: 'input-text'; text: string }
  | { type: 'cursor-left' }
  | { type: 'cursor-right' }
  | { type: 'quit' }
  | { type: 'noop' };

/**
 * Map key events to actions based on current state
 */
export function mapKeyToAction(event: KeyEvent, state: TuiState): KeyAction {
  const { key, shift, ctrl } = event;

  // Global keybindings (work regardless of focus)
  if (key === '\t' || key === 'tab') {
    return shift ? { type: 'focus-prev' } : { type: 'focus-next' };
  }

  if (key === '\x1b' || key === 'escape') {
    return { type: 'quit' };
  }

  if (ctrl && (key === 'c' || key === '\x03')) {
    return { type: 'quit' };
  }

  // Pane-specific keybindings
  const { focusedPane } = state;

  // Transcript pane: scroll navigation
  if (focusedPane === 'transcript') {
    if (key === 'up' || key === '\x1b[A') {
      return { type: 'scroll-up', lines: 1 };
    }
    if (key === 'down' || key === '\x1b[B') {
      return { type: 'scroll-down', lines: 1 };
    }
    if (key === 'pageup' || key === '\x1b[5~') {
      return { type: 'scroll-up', lines: 10 };
    }
    if (key === 'pagedown' || key === '\x1b[6~') {
      return { type: 'scroll-down', lines: 10 };
    }
  }

  // Input pane: history navigation when empty or navigating, cursor movement otherwise
  if (focusedPane === 'input') {
    const inputIsEmpty = state.input.text.length === 0;
    const isNavigatingHistory = state.input.history.currentIndex !== -1;
    const shouldUseHistory = inputIsEmpty || isNavigatingHistory;

    if (key === 'up' || key === '\x1b[A') {
      return shouldUseHistory ? { type: 'history-up' } : { type: 'cursor-left' };
    }
    if (key === 'down' || key === '\x1b[B') {
      return shouldUseHistory ? { type: 'history-down' } : { type: 'cursor-right' };
    }
    if (key === 'left' || key === '\x1b[D') {
      return { type: 'cursor-left' };
    }
    if (key === 'right' || key === '\x1b[C') {
      return { type: 'cursor-right' };
    }

    // Printable characters
    if (key.length === 1 && !ctrl) {
      return { type: 'input-text', text: key };
    }
  }

  return { type: 'noop' };
}

/**
 * Apply key action to state
 */
export function applyKeyAction(state: TuiState, action: KeyAction): TuiState {
  switch (action.type) {
    case 'focus-next':
      return setFocusedPane(state, nextFocusablePane(state.focusedPane));

    case 'focus-prev':
      return setFocusedPane(state, prevFocusablePane(state.focusedPane));

    case 'scroll-up':
      return scrollTranscript(state, -action.lines);

    case 'scroll-down':
      return scrollTranscript(state, action.lines);

    case 'history-up':
      return navigateInputHistory(state, 'up');

    case 'history-down':
      return navigateInputHistory(state, 'down');

    case 'input-text': {
      const { text, cursorPosition } = state.input;
      const newText = text.slice(0, cursorPosition) + action.text + text.slice(cursorPosition);
      return updateInputText(state, newText, cursorPosition + action.text.length);
    }

    case 'cursor-left': {
      const newPos = Math.max(0, state.input.cursorPosition - 1);
      return {
        ...state,
        input: {
          ...state.input,
          cursorPosition: newPos,
        },
      };
    }

    case 'cursor-right': {
      const newPos = Math.min(state.input.text.length, state.input.cursorPosition + 1);
      return {
        ...state,
        input: {
          ...state.input,
          cursorPosition: newPos,
        },
      };
    }

    case 'quit':
      // Handled by app, just return state
      return state;

    case 'noop':
      return state;

    default:
      return state;
  }
}

/**
 * Handle key event (convenience wrapper)
 */
export function handleKeyEvent(state: TuiState, event: KeyEvent): { state: TuiState; shouldQuit: boolean } {
  const action = mapKeyToAction(event, state);
  const newState = applyKeyAction(state, action);
  const shouldQuit = action.type === 'quit';

  return { state: newState, shouldQuit };
}

/**
 * Create keymap handler for TUI app
 */
export function createKeymap() {
  return {
    parseKeyEvent,
    mapKeyToAction,
    applyKeyAction,
    handleKeyEvent,
  };
}
