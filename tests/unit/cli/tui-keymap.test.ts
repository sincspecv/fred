import { describe, expect, test } from 'bun:test';
import {
  parseKeyEvent,
  mapKeyToAction,
  applyKeyAction,
  handleKeyEvent,
  createKeymap,
} from '../../../packages/cli/src/tui/keymap.js';
import {
  createInitialTuiState,
  nextFocusablePane,
  prevFocusablePane,
  addToInputHistory,
} from '../../../packages/cli/src/tui/state.js';

describe('TUI Keymap', () => {
  describe('Focus cycle with Tab', () => {
    test('Tab cycles focus forward from input to sidebar', () => {
      const state = createInitialTuiState();
      expect(state.focusedPane).toBe('input');

      const event = parseKeyEvent('\t');
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('focus-next');

      const newState = applyKeyAction(state, action);
      expect(newState.focusedPane).toBe('sidebar');
    });

    test('Tab cycles through all focusable panes with wraparound', () => {
      const state = createInitialTuiState();

      // input -> sidebar
      const next1 = nextFocusablePane(state.focusedPane);
      expect(next1).toBe('sidebar');

      // sidebar -> transcript
      const next2 = nextFocusablePane(next1);
      expect(next2).toBe('transcript');

      // transcript -> input (wraparound)
      const next3 = nextFocusablePane(next2);
      expect(next3).toBe('input');
    });

    test('Shift+Tab cycles focus backward', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';

      const event = parseKeyEvent('\t');
      event.shift = true; // Simulate Shift+Tab

      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('focus-prev');

      const newState = applyKeyAction(state, action);
      expect(newState.focusedPane).toBe('transcript');
    });

    test('Shift+Tab cycles backward with wraparound', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      // sidebar -> input (wraparound)
      const prev = prevFocusablePane(state.focusedPane);
      expect(prev).toBe('input');
    });
  });

  describe('Status bar never receives focus', () => {
    test('focus cycle skips status bar', () => {
      // Verify status is not in focusable panes list
      const state = createInitialTuiState();

      // Cycle through all panes
      let current = state.focusedPane;
      const visited = [current];

      for (let i = 0; i < 5; i++) {
        current = nextFocusablePane(current);
        visited.push(current);
      }

      // Status should never appear
      expect(visited).not.toContain('status');

      // Should only see sidebar, transcript, input
      const uniquePanes = new Set(visited);
      expect(uniquePanes.size).toBe(3);
      expect(uniquePanes).toContain('sidebar');
      expect(uniquePanes).toContain('transcript');
      expect(uniquePanes).toContain('input');
    });
  });

  describe('Transcript scrolling', () => {
    test('Up arrow scrolls transcript up when transcript focused', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 10;
      state.transcript.viewport.totalLines = 100; // Set totalLines for scrolling

      const event = parseKeyEvent('\x1b[A'); // Up arrow ANSI sequence
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');
      expect(action.lines).toBe(1);

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(9);
    });

    test('Down arrow scrolls transcript down when transcript focused', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 5;
      state.transcript.viewport.totalLines = 100; // Set totalLines for scrolling

      const event = parseKeyEvent('\x1b[B'); // Down arrow
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-down');

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(6);
    });

    test('PgUp scrolls transcript by multiple lines', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 20;
      state.transcript.viewport.totalLines = 100; // Set totalLines for scrolling

      const event = parseKeyEvent('\x1b[5~'); // PgUp
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');
      expect(action.lines).toBe(10);

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(10);
    });

    test('PgDn scrolls transcript down by multiple lines', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 5;
      state.transcript.viewport.totalLines = 100;

      const event = parseKeyEvent('\x1b[6~'); // PgDn
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-down');
      expect(action.lines).toBe(10);

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(15);
    });

    test('scroll up stops at offset 0', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 0;

      const event = parseKeyEvent('\x1b[A'); // Up arrow
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      // Should not go below 0
      expect(newState.transcript.viewport.scrollOffset).toBe(0);
    });
  });

  describe('Input pane Up/Down behavior', () => {
    test('Up arrow navigates history when input is empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.history.entries = ['command 1', 'command 2'];

      const event = parseKeyEvent('\x1b[A'); // Up arrow
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('history-up');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('command 2'); // Most recent
    });

    test('Up arrow moves cursor when input has text', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 5;

      const event = parseKeyEvent('\x1b[A'); // Up arrow
      const action = mapKeyToAction(event, state);

      // When input has text, up arrow is treated as cursor movement
      expect(action.type).toBe('cursor-left');
    });

    test('Down arrow navigates history forward when input is empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.history.entries = ['command 1', 'command 2'];
      state.input.history.currentIndex = 0;

      const event = parseKeyEvent('\x1b[B'); // Down arrow
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('history-down');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('command 2');
    });

    test('Down arrow moves cursor when input has text', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 0;

      const event = parseKeyEvent('\x1b[B'); // Down arrow
      const action = mapKeyToAction(event, state);

      expect(action.type).toBe('cursor-right');
    });

    test('history navigation fills input with selected entry', () => {
      let state = createInitialTuiState();
      state = addToInputHistory(state, 'first command');
      state = addToInputHistory(state, 'second command');

      // Start with empty input
      state.input.text = '';
      state.focusedPane = 'input';

      // Press up - should get most recent
      const event1 = parseKeyEvent('\x1b[A');
      const action1 = mapKeyToAction(event1, state);
      state = applyKeyAction(state, action1);
      expect(state.input.text).toBe('second command');

      // Press up again - should get older
      const event2 = parseKeyEvent('\x1b[A');
      const action2 = mapKeyToAction(event2, state);
      state = applyKeyAction(state, action2);
      expect(state.input.text).toBe('first command');
    });
  });

  describe('Text input handling', () => {
    test('printable characters are added to input', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.cursorPosition = 0;

      const event = parseKeyEvent('a');
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('input-text');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('a');
      expect(newState.input.cursorPosition).toBe(1);
    });

    test('characters are inserted at cursor position', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'helo';
      state.input.cursorPosition = 3; // After 'hel'

      const event = parseKeyEvent('l');
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.text).toBe('hello');
      expect(newState.input.cursorPosition).toBe(4);
    });

    test('cursor left/right navigation', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 3;

      // Move left
      const leftEvent = parseKeyEvent('\x1b[D');
      const leftAction = mapKeyToAction(leftEvent, state);
      const leftState = applyKeyAction(state, leftAction);
      expect(leftState.input.cursorPosition).toBe(2);

      // Move right
      const rightEvent = parseKeyEvent('\x1b[C');
      const rightAction = mapKeyToAction(rightEvent, state);
      const rightState = applyKeyAction(leftState, rightAction);
      expect(rightState.input.cursorPosition).toBe(3);
    });

    test('cursor stops at text boundaries', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hi';
      state.input.cursorPosition = 0;

      // Try to move left from position 0
      const leftEvent = parseKeyEvent('\x1b[D');
      const leftAction = mapKeyToAction(leftEvent, state);
      const leftState = applyKeyAction(state, leftAction);
      expect(leftState.input.cursorPosition).toBe(0);

      // Move to end
      state.input.cursorPosition = 2;

      // Try to move right from end
      const rightEvent = parseKeyEvent('\x1b[C');
      const rightAction = mapKeyToAction(rightEvent, state);
      const rightState = applyKeyAction(state, rightAction);
      expect(rightState.input.cursorPosition).toBe(2);
    });
  });

  describe('Quit handling', () => {
    test('Esc triggers quit action', () => {
      const state = createInitialTuiState();
      const event = parseKeyEvent('\x1b');
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('quit');

      const { shouldQuit } = handleKeyEvent(state, event);
      expect(shouldQuit).toBe(true);
    });

    test('Ctrl+C triggers quit action', () => {
      const state = createInitialTuiState();
      const event = parseKeyEvent('\x03'); // Ctrl+C
      event.ctrl = true;

      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('quit');
    });
  });

  describe('Keymap creation', () => {
    test('createKeymap returns all handlers', () => {
      const keymap = createKeymap();

      expect(keymap.parseKeyEvent).toBeDefined();
      expect(keymap.mapKeyToAction).toBeDefined();
      expect(keymap.applyKeyAction).toBeDefined();
      expect(keymap.handleKeyEvent).toBeDefined();
    });

    test('keymap handles complete key event flow', () => {
      const keymap = createKeymap();
      const state = createInitialTuiState();

      const event = keymap.parseKeyEvent('\t');
      const action = keymap.mapKeyToAction(event, state);
      const newState = keymap.applyKeyAction(state, action);

      expect(newState.focusedPane).not.toBe(state.focusedPane);
    });
  });
});
