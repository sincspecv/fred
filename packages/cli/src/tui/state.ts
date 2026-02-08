/**
 * TUI state model for pane focus and navigation
 *
 * Framework-agnostic state representation that can be tested independently
 * of rendering implementation.
 */

/**
 * Pane identifiers for the TUI layout
 */
export type PaneId = 'sidebar' | 'transcript' | 'input' | 'status';

/**
 * Focusable panes (status is display-only)
 */
export type FocusablePaneId = Exclude<PaneId, 'status'>;

/**
 * Transcript viewport state for scrolling
 */
export interface TranscriptViewport {
  scrollOffset: number;
  totalLines: number;
  visibleLines: number;
}

/**
 * Input history state for Up/Down navigation
 */
export interface InputHistory {
  entries: string[];
  currentIndex: number;
}

/**
 * Complete TUI application state
 */
export interface TuiState {
  focusedPane: FocusablePaneId;
  transcript: {
    viewport: TranscriptViewport;
    messages: Array<{ role: string; content: string }>;
  };
  input: {
    text: string;
    cursorPosition: number;
    history: InputHistory;
  };
  sidebar: {
    selectedIndex: number;
    items: string[];
  };
}

/**
 * Create initial TUI state with input pane focused
 */
export function createInitialTuiState(): TuiState {
  return {
    focusedPane: 'input',
    transcript: {
      viewport: {
        scrollOffset: 0,
        totalLines: 0,
        visibleLines: 20,
      },
      messages: [],
    },
    input: {
      text: '',
      cursorPosition: 0,
      history: {
        entries: [],
        currentIndex: -1,
      },
    },
    sidebar: {
      selectedIndex: 0,
      items: [],
    },
  };
}

/**
 * Focus navigation helpers
 */
const FOCUSABLE_PANES: FocusablePaneId[] = ['sidebar', 'transcript', 'input'];

/**
 * Get next focusable pane with wraparound
 */
export function nextFocusablePane(current: FocusablePaneId): FocusablePaneId {
  const currentIndex = FOCUSABLE_PANES.indexOf(current);
  const nextIndex = (currentIndex + 1) % FOCUSABLE_PANES.length;
  return FOCUSABLE_PANES[nextIndex];
}

/**
 * Get previous focusable pane with wraparound
 */
export function prevFocusablePane(current: FocusablePaneId): FocusablePaneId {
  const currentIndex = FOCUSABLE_PANES.indexOf(current);
  const prevIndex = currentIndex === 0 ? FOCUSABLE_PANES.length - 1 : currentIndex - 1;
  return FOCUSABLE_PANES[prevIndex];
}

/**
 * Apply focus change to state
 */
export function setFocusedPane(state: TuiState, pane: FocusablePaneId): TuiState {
  return {
    ...state,
    focusedPane: pane,
  };
}

/**
 * Scroll transcript viewport
 */
export function scrollTranscript(state: TuiState, delta: number): TuiState {
  const newOffset = Math.max(
    0,
    Math.min(
      state.transcript.viewport.totalLines - state.transcript.viewport.visibleLines,
      state.transcript.viewport.scrollOffset + delta
    )
  );

  return {
    ...state,
    transcript: {
      ...state.transcript,
      viewport: {
        ...state.transcript.viewport,
        scrollOffset: newOffset,
      },
    },
  };
}

/**
 * Update input text and cursor position
 */
export function updateInputText(state: TuiState, text: string, cursorPosition?: number): TuiState {
  return {
    ...state,
    input: {
      ...state.input,
      text,
      cursorPosition: cursorPosition ?? text.length,
    },
  };
}

/**
 * Navigate input history (Up/Down when input is empty)
 */
export function navigateInputHistory(state: TuiState, direction: 'up' | 'down'): TuiState {
  const { history, text } = state.input;

  // Only navigate history when input is empty
  if (text.length > 0) {
    return state;
  }

  if (history.entries.length === 0) {
    return state;
  }

  let newIndex: number;
  if (direction === 'up') {
    // Go back in history (older)
    newIndex = history.currentIndex === -1
      ? history.entries.length - 1
      : Math.max(0, history.currentIndex - 1);
  } else {
    // Go forward in history (newer)
    if (history.currentIndex === -1) {
      return state;
    }
    newIndex = history.currentIndex + 1;
    if (newIndex >= history.entries.length) {
      // Return to empty input
      return {
        ...state,
        input: {
          ...state.input,
          text: '',
          cursorPosition: 0,
          history: {
            ...history,
            currentIndex: -1,
          },
        },
      };
    }
  }

  const historyText = history.entries[newIndex];
  return {
    ...state,
    input: {
      ...state.input,
      text: historyText,
      cursorPosition: historyText.length,
      history: {
        ...history,
        currentIndex: newIndex,
      },
    },
  };
}

/**
 * Add entry to input history
 */
export function addToInputHistory(state: TuiState, entry: string): TuiState {
  if (!entry.trim()) {
    return state;
  }

  return {
    ...state,
    input: {
      ...state.input,
      history: {
        entries: [...state.input.history.entries, entry],
        currentIndex: -1,
      },
    },
  };
}
