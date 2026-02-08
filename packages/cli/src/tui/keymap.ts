/**
 * Keyboard event handling and key bindings
 *
 * Uses OpenTUI KeyEvent for structured key parsing.
 *
 * Implements focus cycle and navigation rules:
 * - Tab: cycle focus forward with wraparound
 * - Shift+Tab: cycle focus backward with wraparound
 * - Status bar excluded from focus order
 * - Transcript: Up/Down and PgUp/PgDn for scrolling
 * - Input: Up/Down for history when empty, cursor movement otherwise
 * - Enter: submit input
 * - Backspace/Delete: character removal
 */

import type { KeyEvent } from '@opentui/core';
import type { TuiState } from './state.js';
import {
  nextFocusablePane,
  prevFocusablePane,
  setFocusedPane,
  scrollTranscript,
  navigateInputHistory,
  updateInputText,
  submitInput,
  backspaceAtCursor,
  deleteAtCursor,
} from './state.js';

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
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'submit' }
  | { type: 'quit' }
  | { type: 'noop' };

/**
 * Map key events to actions based on current state
 */
export function mapKeyToAction(event: KeyEvent, state: TuiState): KeyAction {
  const { name, shift, ctrl, meta } = event;

  // Global keybindings (work regardless of focus)
  if (name === 'tab') {
    return shift ? { type: 'focus-prev' } : { type: 'focus-next' };
  }

  if (name === 'escape') {
    return { type: 'quit' };
  }

  if (ctrl && name === 'c') {
    return { type: 'quit' };
  }

  // Pane-specific keybindings
  const { focusedPane } = state;

  // Transcript pane: scroll navigation
  if (focusedPane === 'transcript') {
    if (name === 'up') {
      return { type: 'scroll-up', lines: 1 };
    }
    if (name === 'down') {
      return { type: 'scroll-down', lines: 1 };
    }
    if (name === 'pageup') {
      return { type: 'scroll-up', lines: 10 };
    }
    if (name === 'pagedown') {
      return { type: 'scroll-down', lines: 10 };
    }
  }

  // Input pane: history navigation when empty or navigating, cursor movement otherwise
  if (focusedPane === 'input') {
    const inputIsEmpty = state.input.text.length === 0;
    const isNavigatingHistory = state.input.history.currentIndex !== -1;
    const shouldUseHistory = inputIsEmpty || isNavigatingHistory;

    if (name === 'enter' || name === 'return') {
      return { type: 'submit' };
    }

    if (name === 'backspace') {
      return { type: 'backspace' };
    }

    if (name === 'delete') {
      return { type: 'delete' };
    }

    if (name === 'up') {
      return shouldUseHistory ? { type: 'history-up' } : { type: 'cursor-left' };
    }
    if (name === 'down') {
      return shouldUseHistory ? { type: 'history-down' } : { type: 'cursor-right' };
    }
    if (name === 'left') {
      return { type: 'cursor-left' };
    }
    if (name === 'right') {
      return { type: 'cursor-right' };
    }

    // Printable characters: single char name, no ctrl/meta modifiers
    if (name.length === 1 && !ctrl && !meta) {
      return { type: 'input-text', text: name };
    }

    // Space key
    if (name === 'space') {
      return { type: 'input-text', text: ' ' };
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

    case 'backspace':
      return backspaceAtCursor(state);

    case 'delete':
      return deleteAtCursor(state);

    case 'submit':
      return submitInput(state).state;

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
export function handleKeyEvent(state: TuiState, event: KeyEvent): { state: TuiState; action: KeyAction } {
  const action = mapKeyToAction(event, state);
  const newState = applyKeyAction(state, action);

  return { state: newState, action };
}
