import { describe, expect, test } from 'bun:test';
import {
  calculatePaneLayouts,
  getPaneLayout,
  renderSidebarContent,
  renderTranscriptContent,
  renderInputContent,
  renderStatusContent,
  renderAllPanes,
  DEFAULT_LAYOUT,
  STARTUP_HINT,
} from '../../../packages/cli/src/tui/layout.js';
import { createInitialTuiState } from '../../../packages/cli/src/tui/state.js';

describe('TUI Layout', () => {
  describe('Pane layout calculation', () => {
    test('calculates correct pane regions for standard terminal', () => {
      const layouts = calculatePaneLayouts(120, 40);

      expect(layouts).toHaveLength(4);
      expect(layouts.map((l) => l.id)).toEqual(['sidebar', 'transcript', 'input', 'status']);
    });

    test('sidebar is focusable with correct dimensions', () => {
      const layouts = calculatePaneLayouts(120, 40);
      const sidebar = getPaneLayout(layouts, 'sidebar');

      expect(sidebar).toBeDefined();
      expect(sidebar?.focusable).toBe(true);
      expect(sidebar?.region.width).toBe(DEFAULT_LAYOUT.sidebarWidth);
      expect(sidebar?.region.x).toBe(0);
    });

    test('transcript is focusable and occupies main area', () => {
      const layouts = calculatePaneLayouts(120, 40);
      const transcript = getPaneLayout(layouts, 'transcript');

      expect(transcript).toBeDefined();
      expect(transcript?.focusable).toBe(true);
      expect(transcript?.region.x).toBe(DEFAULT_LAYOUT.sidebarWidth);
    });

    test('input bar is focusable at bottom', () => {
      const layouts = calculatePaneLayouts(120, 40);
      const input = getPaneLayout(layouts, 'input');

      expect(input).toBeDefined();
      expect(input?.focusable).toBe(true);
      expect(input?.region.height).toBe(DEFAULT_LAYOUT.inputHeight);
    });

    test('status bar is NOT focusable', () => {
      const layouts = calculatePaneLayouts(120, 40);
      const status = getPaneLayout(layouts, 'status');

      expect(status).toBeDefined();
      expect(status?.focusable).toBe(false);
      expect(status?.region.height).toBe(DEFAULT_LAYOUT.statusHeight);
    });

    test('custom layout configuration', () => {
      const customConfig = {
        sidebarWidth: 40,
        inputHeight: 5,
        statusHeight: 2,
      };

      const layouts = calculatePaneLayouts(120, 40, customConfig);
      const sidebar = getPaneLayout(layouts, 'sidebar');
      const input = getPaneLayout(layouts, 'input');

      expect(sidebar?.region.width).toBe(40);
      expect(input?.region.height).toBe(5);
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

    test('renders input bar with empty input', () => {
      const state = createInitialTuiState();
      const content = renderInputContent(state, false);

      expect(content.lines.join('\n')).toContain('>');
    });

    test('renders input bar with text', () => {
      const state = createInitialTuiState();
      state.input.text = 'test message';
      state.input.cursorPosition = 12;

      const content = renderInputContent(state, false);

      expect(content.lines.join('\n')).toContain('test message');
    });

    test('input bar shows cursor indicator when focused', () => {
      const state = createInitialTuiState();
      state.input.text = 'test';
      state.input.cursorPosition = 4;

      const focused = renderInputContent(state, true);
      const unfocused = renderInputContent(state, false);

      expect(focused.lines.join('\n')).toContain('[4]');
      expect(unfocused.lines.join('\n')).not.toContain('[4]');
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

    test('renders all panes with correct initial focus', () => {
      const state = createInitialTuiState();
      const panes = renderAllPanes(state, 120, 40);

      // Input should show focus indicator
      expect(panes.input.focusIndicator).toBe('*');

      // Others should not
      expect(panes.sidebar.focusIndicator).toBeUndefined();
      expect(panes.transcript.focusIndicator).toBeUndefined();

      // Status never has focus indicator
      expect(panes.status.focusIndicator).toBeUndefined();
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
      // Add enough messages to require scrolling
      state.transcript.messages = Array.from({ length: 30 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));
      state.transcript.viewport.totalLines = 90; // 3 lines per message
      state.transcript.viewport.scrollOffset = 10;

      const content = renderTranscriptContent(state, false);

      // Should render a subset based on viewport
      expect(content.lines.length).toBeLessThanOrEqual(state.transcript.viewport.visibleLines);
    });
  });
});
