import { describe, expect, test } from 'bun:test';
import {
  renderSidebarContent,
  renderTranscriptContent,
  renderStatusContent,
  DEFAULT_LAYOUT,
  STARTUP_HINT,
} from '../../../packages/cli/src/tui/layout.js';
import { createInitialTuiState } from '../../../packages/cli/src/tui/state.js';

describe('TUI Layout', () => {
  describe('Default layout config', () => {
    test('has expected sidebar width', () => {
      expect(DEFAULT_LAYOUT.sidebarWidth).toBe(30);
    });

    test('has expected input height', () => {
      expect(DEFAULT_LAYOUT.inputHeight).toBe(3);
    });

    test('has expected status height', () => {
      expect(DEFAULT_LAYOUT.statusHeight).toBe(1);
    });
  });

  describe('Pane content rendering', () => {
    test('renders sidebar with empty state', () => {
      const state = createInitialTuiState();
      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('[Sessions]');
      expect(content.lines).toContain('(empty)');
    });

    test('renders sidebar with items', () => {
      const state = createInitialTuiState();
      state.sidebar.items = ['Session 1', 'Session 2'];

      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('Session 1');
      expect(content.lines).toContain('Session 2');
    });

    test('sidebar shows focus indicator when focused', () => {
      const state = createInitialTuiState();
      const focused = renderSidebarContent(state, true);
      const unfocused = renderSidebarContent(state, false);

      expect(focused.focusIndicator).toBe('>');
      expect(unfocused.focusIndicator).toBeUndefined();
    });

    test('renders empty transcript with welcome message', () => {
      const state = createInitialTuiState();
      const content = renderTranscriptContent(state, false);

      expect(content.lines.join(' ')).toContain('Fred AI Framework');
      expect(content.lines.join(' ')).toContain('Type a message');
    });

    test('renders transcript with messages', () => {
      const state = createInitialTuiState();
      state.transcript.messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const content = renderTranscriptContent(state, false);

      expect(content.lines.join('\n')).toContain('user:');
      expect(content.lines.join('\n')).toContain('Hello');
      expect(content.lines.join('\n')).toContain('assistant:');
      expect(content.lines.join('\n')).toContain('Hi there!');
    });

    test('renders status bar with focus indicator', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';

      const content = renderStatusContent(state);

      expect(content.lines[0]).toContain('Focus: transcript');
      expect(content.lines[0]).toContain('Tab: cycle focus');
    });
  });

  describe('Initial focus state', () => {
    test('initial state has input pane focused', () => {
      const state = createInitialTuiState();

      expect(state.focusedPane).toBe('input');
    });
  });

  describe('Startup hint', () => {
    test('startup hint is defined and informative', () => {
      expect(STARTUP_HINT).toBeTruthy();
      expect(STARTUP_HINT.toLowerCase()).toContain('tab');
      expect(STARTUP_HINT.toLowerCase()).toContain('esc');
    });
  });

  describe('Viewport scrolling behavior', () => {
    test('transcript viewport starts at offset 0', () => {
      const state = createInitialTuiState();

      expect(state.transcript.viewport.scrollOffset).toBe(0);
    });

    test('transcript viewport shows visible lines subset', () => {
      const state = createInitialTuiState();
      state.transcript.messages = Array.from({ length: 30 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));
      state.transcript.viewport.totalLines = 90;
      state.transcript.viewport.scrollOffset = 10;

      const content = renderTranscriptContent(state, false);

      expect(content.lines.length).toBeLessThanOrEqual(state.transcript.viewport.visibleLines);
    });
  });
});
