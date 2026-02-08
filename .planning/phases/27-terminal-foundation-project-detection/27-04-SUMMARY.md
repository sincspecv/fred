---
phase: 27-terminal-foundation-project-detection
plan: 04
subsystem: cli-tui
tags: [smoke-tests, verification, integration, terminal-rendering]
requires: [27-03]
provides:
  - Cross-module smoke tests for command and mode routing
  - Human-verified interactive TUI rendering
  - Full ANSI terminal rendering loop wired into TUI app
affects: [packages/cli, tests/unit/cli]
tech-stack:
  added: []
  patterns:
    - ANSI escape sequence rendering with cursor positioning
    - Raw stdin character-by-character reading
    - Human verification checkpoint gate
key-files:
  created:
    - tests/unit/cli/phase27-smoke.test.ts
  modified:
    - packages/cli/src/tui/app.ts
    - packages/cli/src/commands/chat.ts
key-decisions:
  - decision: "Rewrote TUI app with full ANSI rendering loop during checkpoint verification"
    rationale: "Human verification revealed TUI app only printed startup text without rendering panes or entering raw mode"
    impact: "Interactive TUI now renders multi-pane layout with real-time keyboard input"
metrics:
  duration: "~12 min (including human checkpoint)"
  completed: "2026-02-08"
---

# Phase 27 Plan 04: Smoke Tests and Human Verification Summary

**One-liner:** Phase-level smoke tests for command/mode routing plus human-verified interactive TUI rendering with full ANSI terminal loop.

## Performance

- **Duration:** ~12 minutes (including human checkpoint wait)
- **Tasks completed:** 2/2 (1 automated + 1 human checkpoint)
- **Tests added:** 12 test cases in smoke suite
- **Critical fix:** TUI rendering loop wired during checkpoint verification

## Accomplishments

### Task 1: Phase-Level Smoke Tests

**Delivered:**
- `tests/unit/cli/phase27-smoke.test.ts`: 12 tests covering cross-module phase behavior

**Coverage areas:**
- Bare command path emits help-first guidance including `fred chat`
- Chat command selects interactive branch in TTY mode (verifies raw mode, stdin resume, stdout write, data listener)
- Chat command selects non-interactive branch in non-TTY mode (JSON output, exit code 1)
- No raw-mode APIs invoked in non-TTY mode (setRawMode never called)
- Command routing integration (chat case in CLI index, mode detection drives routing)

### Task 2: Human Verification Checkpoint

**Verification performed:**
1. `bun run packages/cli/src/index.ts` - Help-first output confirmed with `fred chat` reference
2. `bun run packages/cli/src/index.ts -- chat` - Interactive TUI renders with panes
3. Tab/Shift+Tab focus cycling confirmed, status bar excluded
4. Transcript scroll keys work when transcript focused
5. Ctrl+C exits cleanly with cursor visible and terminal restored
6. `bun run packages/cli/src/index.ts -- chat | cat` - Non-interactive JSON output, no crash

**Critical fix discovered during checkpoint:**
The TUI app only printed startup hint text without entering raw mode or rendering ANSI panes. Rewrote `app.ts` with complete ANSI rendering loop and simplified `chat.ts` to delegate terminal handling.

## Task Commits

| Task | Commit  | Description                                                    |
| ---- | ------- | -------------------------------------------------------------- |
| 1    | 9f55bf6 | Add phase-level smoke tests for command and mode routing       |
| fix  | 9240eae | Wire interactive TUI rendering loop with raw stdin and ANSI output |

## Files Created/Modified

**Created (1 file):**
- `tests/unit/cli/phase27-smoke.test.ts` (402 lines)

**Modified (2 files):**
- `packages/cli/src/tui/app.ts`: Rewrote with full ANSI rendering (renderToTerminal), raw mode entry, stdin reading, resize handling, clean teardown
- `packages/cli/src/commands/chat.ts`: Simplified to delegate all terminal handling to TUI app

## Deviations from Plan

### TUI Rendering Loop Fix

**Context:** Human checkpoint revealed TUI app was non-functional in real terminal

**Root cause:** `FredTuiApp.start()` only called `process.stdin.resume()` and printed startup text; no raw mode, no ANSI rendering, no character-by-character key reading

**Resolution:** Rewrote `app.ts` with:
- `renderToTerminal()`: Full ANSI escape sequence rendering with cursor positioning for all panes
- `start()`: Raw mode entry, stdin resume, encoding setup, clear screen, render, data event listener, resize handler
- `stop()`: Clean teardown with raw mode exit, cursor restore, screen clear
- `processKey()`: Parse key event, update state, re-render

**Impact:** This was a critical fix - without it, the TUI was non-functional despite all unit tests passing. The unit tests validated state/keymap logic correctly but didn't catch the missing rendering loop.

## Issues Encountered

### 1. TUI App Missing Rendering Loop

**Issue:** `fred chat` printed "Starting Fred chat..." but no interactive TUI appeared
**Root cause:** app.ts start() had no ANSI rendering or raw stdin reading
**Resolution:** Complete rewrite of start/stop/renderToTerminal methods
**Prevention:** Smoke tests now verify setRawMode, stdout.write, and stdin data listener registration

### 2. process.stdin.setEncoding Not a Function in Tests

**Issue:** Bun test mock for stdin didn't include setEncoding
**Resolution:** Added guard `if (typeof process.stdin.setEncoding === 'function')` in app.ts
**Impact:** Tests pass without needing full stdin mock surface

### 3. process.stdout.write Not a Function in Tests

**Issue:** Smoke test mockStdout lacked write method needed by renderToTerminal
**Resolution:** Updated smoke test mocks to include write, on methods on stdout and setEncoding, on, removeListener, pause on stdin
**Impact:** All 66 tests pass including new smoke suite

## Next Phase Readiness

**Phase 28 (Streaming Performance) dependencies fully satisfied:**

- TUI shell renders multi-pane layout with ANSI escapes
- Raw mode keyboard input works character-by-character
- State model supports incremental updates
- Transcript viewport supports scroll and rendering
- Clean teardown restores terminal on exit
- Chat command routes to fully functional TUI app

**Phase 28 focus areas:**
- Token-by-token streaming into transcript pane
- Throttle/buffer operators for high-frequency updates
- Performance profiling at 100+ tokens/sec
- Backpressure handling to prevent memory bloat

**No blockers identified for next phase.**

## Self-Check

**Checking created files:**
```
FOUND: tests/unit/cli/phase27-smoke.test.ts
```

**Checking commits:**
```
FOUND: 9f55bf6 (Task 1: smoke tests)
FOUND: 9240eae (fix: TUI rendering loop)
```

**Test results:**
```
phase27-smoke.test.ts: 12 pass, 0 fail
All 66 project tests: pass
```

## Self-Check: PASSED

All claimed deliverables verified. Plan 27-04 execution complete.
