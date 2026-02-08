/**
 * TUI App Integration Tests
 *
 * Tests FredTuiApp using OpenTUI's createTestRenderer for headless testing.
 * Verifies the full key→state→UI pipeline without a real terminal.
 */

import { describe, expect, test, afterEach } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { FredTuiApp } from '../../../packages/cli/src/tui/app.js';

/**
 * Helper to create an OpenTUI KeyEvent for testing
 */
function makeKey(overrides: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: overrides.name,
    sequence: overrides.sequence ?? '',
    ctrl: overrides.ctrl ?? false,
    shift: overrides.shift ?? false,
    meta: overrides.meta ?? false,
    option: overrides.option ?? false,
    eventType: overrides.eventType ?? 'press',
    repeated: overrides.repeated ?? false,
  };
}

describe('TUI App (OpenTUI integration)', () => {
  let testSetup: Awaited<ReturnType<typeof createTestRenderer>>;
  let app: FredTuiApp;

  afterEach(() => {
    if (app && app.isRunning()) {
      app.stop();
    }
    if (testSetup) {
      try {
        testSetup.renderer.destroy();
      } catch {
        // Already destroyed
      }
    }
  });

  async function createTestApp(events: Parameters<typeof FredTuiApp.createWithRenderer>[1] = {}) {
    testSetup = await createTestRenderer({
      width: 120,
      height: 40,
    });
    app = FredTuiApp.createWithRenderer(testSetup.renderer, events);
    return { testSetup, app };
  }

  test('initial render shows all panes', async () => {
    await createTestApp();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // Should contain sidebar title
    expect(frame).toContain('[Sessions]');

    // Should contain welcome message
    expect(frame).toContain('Fred AI Framework');

    // Should contain focus status
    expect(frame).toContain('Focus: input');
  });

  test('Tab cycles focus', async () => {
    await createTestApp();

    // Initial focus is input
    expect(app.getState().focusedPane).toBe('input');

    // Tab: input -> sidebar
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('sidebar');

    // Tab: sidebar -> transcript
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('transcript');

    // Tab: transcript -> input (wraparound)
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('input');

    // Render and verify status reflects current focus
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('Focus: input');
  });

  test('Shift+Tab cycles focus backward', async () => {
    await createTestApp();

    // Initial: input
    expect(app.getState().focusedPane).toBe('input');

    // Shift+Tab: input -> transcript
    app.processKey(makeKey({ name: 'tab', shift: true }));
    expect(app.getState().focusedPane).toBe('transcript');
  });

  test('typing updates input', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));

    expect(app.getState().input.text).toBe('hi');
    expect(app.getState().input.cursorPosition).toBe(2);
  });

  test('Enter submits and clears input', async () => {
    let submitted = '';
    await createTestApp({
      onSubmit: (text) => { submitted = text; },
    });

    // Type something
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    expect(app.getState().input.text).toBe('hi');

    // Submit
    app.processKey(makeKey({ name: 'enter' }));
    expect(app.getState().input.text).toBe('');
    expect(app.getState().input.cursorPosition).toBe(0);
    expect(submitted).toBe('hi');
  });

  test('backspace deletes character', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'b' }));
    app.processKey(makeKey({ name: 'c' }));
    expect(app.getState().input.text).toBe('abc');

    app.processKey(makeKey({ name: 'backspace' }));
    expect(app.getState().input.text).toBe('ab');
    expect(app.getState().input.cursorPosition).toBe(2);
  });

  test('up arrow navigates history', async () => {
    await createTestApp();

    // Type and submit first command
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    expect(app.getState().input.text).toBe('');

    // Press up to recall
    app.processKey(makeKey({ name: 'up' }));
    expect(app.getState().input.text).toBe('hi');
  });

  test('Escape triggers quit and destroy', async () => {
    let quitFired = false;
    await createTestApp({
      onQuit: () => { quitFired = true; },
    });

    expect(app.isRunning()).toBe(true);

    app.processKey(makeKey({ name: 'escape' }));

    expect(app.isRunning()).toBe(false);
    expect(quitFired).toBe(true);
  });

  test('onStateChange fires on state updates', async () => {
    const states: any[] = [];
    await createTestApp({
      onStateChange: (state) => { states.push(state); },
    });

    app.processKey(makeKey({ name: 'tab' }));
    expect(states.length).toBeGreaterThan(0);
    expect(states[states.length - 1].focusedPane).toBe('sidebar');
  });
});
