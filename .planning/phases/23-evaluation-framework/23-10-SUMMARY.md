---
phase: 23-evaluation-framework
plan: 10
subsystem: cli
tags: [replay, config-less, evaluation, artifact]

# Dependency graph
requires:
  - phase: 23-07
    provides: "Conditional config initialization in replay core"
provides:
  - "Config-less replay mode in CLI eval command"
  - "Artifact-only replay runtime adapter"
  - "Clear error messages for missing traces vs missing config"
affects:
  - "Phase 24 - Tool Access Control (uses replay for validation)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional configPath parameter with undefined default"
    - "Artifact-only replay runtime for validation workflows"
    - "Conditional runtime initialization based on config availability"

key-files:
  created:
    - "tests/integration/cli/eval-replay-configless.test.ts"
  modified:
    - "packages/cli/src/eval.ts"
    - "packages/cli/src/index.ts"

key-decisions:
  - "Only initialize from config when configPath is explicitly provided"
  - "Artifact-only runtime returns checkpoint data directly for validation"
  - "Help text clarifies config is optional for replay operations"

patterns-established:
  - "Config-less mode: Support artifact-only workflows without Fred config"
  - "Conditional runtime: Create appropriate runtime based on config availability"

# Metrics
duration: 6min
completed: 2026-02-06
---

# Phase 23 Plan 10: Config-less Replay Mode Summary

**Config-less replay mode enabling `fred eval replay --trace-id <id>` to work without requiring a Fred config file, using artifact/checkpoint data for validation workflows.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-06T21:52:37Z
- **Completed:** 2026-02-06T21:58:37Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

1. **Modified CLI replay service** to make configPath truly optional
   - Changed replay service to only use config when explicitly provided
   - Created `createArtifactOnlyReplayRuntime()` for config-less mode
   - Artifact-only runtime returns checkpoint data for validation workflows

2. **Updated CLI help text** to clarify config is optional for replay
   - Changed replay help line to indicate "config optional"
   - Documented that replay "uses artifact data when no config"
   - Listed --config as an optional flag for replay

3. **Added integration test** validating config-less replay behavior
   - Tests that replay works without config file
   - Tests that error messages mention missing traces, not missing config
   - Tests that --from-step works without config

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove config requirement from CLI replay service** - `1673f02` (feat)
2. **Task 2: Update CLI help text for config-less replay** - `37b742d` (docs)
3. **Task 3: Add integration test for config-less replay** - `e5bf4de` (test)

**Plan metadata:** `[pending]` (docs: complete plan)

## Files Created/Modified

- `packages/cli/src/eval.ts` - Modified replay service with optional config and artifact-only runtime
- `packages/cli/src/index.ts` - Updated help text to clarify config is optional
- `tests/integration/cli/eval-replay-configless.test.ts` - New integration test for config-less mode

## Decisions Made

1. **Only initialize from config when explicitly provided** - The replay service now only calls `initializeFromConfig` when a configPath is actually provided. This enables artifact-only workflows.

2. **Artifact-only runtime returns checkpoint data** - When no config is provided, the runtime returns the checkpoint and context snapshot directly, suitable for validation workflows that don't need full Fred initialization.

3. **Help text emphasizes optionality** - Rather than removing config mentions entirely, the help text now clearly states "config optional" to set proper expectations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap closure complete for UAT-identified replay config requirement issue
- Replay now supports both config-backed and artifact-only modes
- Ready to continue with Phase 24 - Tool Access Control

---
*Phase: 23-evaluation-framework*
*Completed: 2026-02-06*
