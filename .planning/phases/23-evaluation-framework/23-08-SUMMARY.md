---
phase: 23-evaluation-framework
plan: 08
subsystem: evaluation
tags: evaluation, suite, metrics, confusion-matrix, CLI

# Dependency graph
requires:
  - phase: 23-07 (eval record/replay gap closure)
    provides: Record layer composition fix, config-less replay support
  - phase: 23-04 (intent metrics and suite manifests)
    provides: Suite runner with aggregate metrics, confusion matrix support
  - phase: 23-02 (assertions and comparison)
    provides: Core assertion runner, comparator with normalized semantics
provides:
  - Default suite command wired to core suite runner
  - Suite execution returns aggregate pass/fail counts, latency/token rollups
  - Intent diagnostics including confusion-matrix payloads in suite output
  - Eval help text aligned with actual CLI behavior
  - End-to-end default eval regression test coverage
affects:
  - Phase 24 (Tool Access Control) - evaluation framework complete, ready for tool gating workflows
  - Phase 25 (MCP Integration) - evaluation metrics infrastructure ready
  - UAT phase - can now verify all eval commands work correctly

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CLI eval commands use core-backed flows instead of placeholders
    - Suite runner delegates to core evaluation.runSuite with proper case execution
    - Aggregate metrics (totals, latency, tokenUsage, intentQuality) computed from suite results
    - Consistent exit semantics across all eval subcommands (0 success, 2 suite/regression, 1 error)

key-files:
  created: []
  modified:
    - packages/cli/src/eval.ts - Wired suite() to core runSuite
    - packages/cli/src/index.ts - Updated help text for eval commands
    - tests/unit/cli/eval.test.ts - Added end-to-end regression tests

key-decisions:
  - Use evaluation.runSuite for default CLI suite command (core-backed strategy)
  - Keep JSON/text envelope conventions for suite output
  - Preserve exit semantics (0 success, 2 suite failure, 1 runtime error)

patterns-established:
  - CLI eval subcommands (record/replay/compare/suite) all use same core-backed strategy
  - Suite runner calls orchestrator.replay for each test case
  - Aggregate metrics computed from individual case results
  - Intent diagnostics include confusion matrix for classification analysis

# Metrics
duration: 12min
completed: 2026-02-06
---

# Phase 23 Plan 8: Suite Default-Path and Diagnostics Gap Closure

**Default `fred eval suite` now executes real core suite runner with aggregate metrics and intent diagnostics.**

## Performance

- **Duration:** 12min
- **Started:** 2026-02-06T19:49:19Z
- **Completed:** 2026-02-06T20:02:43Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Wired default suite command to core suite runner**
  - Replaced placeholder `suite()` implementation with concrete `evaluation.runSuite` invocation
  - Added `runSuiteFn` and `parseSuiteManifestFn` options for testability
  - Suite execution uses orchestrator.replay for each test case
  - Returns `SuiteReport` with aggregate metrics: totals, latency, tokenUsage, regressions, intentQuality

- **Updated CLI help text to reflect implemented defaults**
  - Added replay checkpoint and mode options to help: `--from-step <n> --mode retry|skip|restart`
  - Updated suite description to mention aggregate metrics and intent diagnostics
  - Aligned help descriptions with actual CLI behavior after Plan 23-07

- **Added end-to-end default eval regression tests**
  - Test to verify suite does not return placeholder message
  - Test to verify suite includes aggregate metrics in output
  - Tests verify default eval commands are core-backed (no host-wiring placeholder messages)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire default suite command to core suite runner and diagnostics output** - `2491edc` (feat)
2. **Task 2: Align eval help text and error contract with implemented defaults** - `0168287` (docs)
3. **Task 3: Add end-to-end default eval regression tests across all subcommands** - `8897499` (test)

**Plan metadata:** N/A (will commit separately)

## Files Created/Modified

- `packages/cli/src/eval.ts` - Suite execution wired to core runSuite with aggregate metrics
- `packages/cli/src/index.ts` - Updated eval help text with replay/suite options
- `tests/unit/cli/eval.test.ts` - Added end-to-end default eval regression tests

## Decisions Made

- Use `evaluation.runSuite` from `@fancyrobot/fred` evaluation namespace for default suite command
- Suite execution calls orchestrator.replay for each test case, not placeholder message
- Preserve JSON/text envelope format (`EvalResultEnvelope`) for consistent CLI output
- Keep exit semantics: 0 success, 2 suite failure/regression, 1 runtime/input errors
- Add testability options (`runSuiteFn`, `parseSuiteManifestFn`, `readFileFn`) to `DefaultEvalCommandServiceOptions`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tasks completed successfully with tests passing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 23 Evaluation Framework is now complete with all 8 plans executed:
- Suite command is core-backed and returns aggregate metrics
- Intent diagnostics and confusion matrix included in suite output
- All eval subcommands (record/replay/compare/suite) use consistent core-backed flows
- End-to-end regression tests in place to prevent future regressions

Ready for Phase 24 (Tool Access Control) which builds on evaluation framework capabilities.

---
*Phase: 23-evaluation-framework*
*Completed: 2026-02-06*
