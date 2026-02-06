# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.3.0 milestone — Phase 24 queued after completing Phase 23 evaluation framework
**Milestone:** v0.3.0 Observability & Safety (Phases 22-26)

---

## Current Position

**Phase:** 23 — Evaluation Framework
**Plan:** 10 of 10 plans complete
**Status:** Phase complete
**Last activity:** 2026-02-06 — Completed 23-10-PLAN.md (config-less replay mode gap closure)

**Progress:** ████████████ 100% (103/103 plans complete)

| Phase | Name | Requirements | Plans | Status |
|-------|------|--------------|-------|--------|
| 22 | Observability Foundation | 8 | 8/8 | ✅ Complete |
| 23 | Evaluation Framework | 8 | 10/10 | ✅ Complete |
| 24 | Tool Access Control | 8 | — | ⚪ Not started |
| 25 | MCP Integration | 10 | — | ⚪ Not started |
| 26 | Routing Explainability | 3 | — | ⚪ Not started |

---

## Milestone History

**v0.3.0 — IN PROGRESS**
- Target: 5 phases (22-26)
- 35 requirements mapped
- Phase 22: ✅ Complete (2026-02-06)
- Phase 23: ✅ Complete (2026-02-06)
- Next: Execute 24-01-PLAN.md

**v0.3.1 — PLANNED**
- CLI/TUI developer experience
- Waiting for v0.3.0 completion

**v0.2.0 — SHIPPED 2026-02-01**
- 22 phases, 86 plans, 1,072 tests
- 8 monorepo packages published
- 17/17 v1 requirements complete
- See: .planning/milestones/v0.2.0-ROADMAP.md

---

## Phase 22: Observability Foundation — COMPLETE

**Verification:** PASSED (8/8 success criteria)
**Report:** .planning/phases/22-observability-foundation/22-VERIFICATION.md

**What was built:**
- `ObservabilityService` with deterministic sampling, structured JSON logging, Effect Metrics
- AsyncLocalStorage-backed correlation context (runId, conversationId, intentId, traceId, spanId)
- Hook-to-observability bridge with outcome tracking (executed/skipped/aborted/modified/error)
- MessageProcessor lifecycle hooks with correlation propagation + intent metadata tagging
- Pipeline/graph step spans with branch decision events + handoff trace events
- Token usage/cost metrics per run, golden trace export (JSON/Prometheus/OTel)
- exportTrace wired into hook context for evaluation workflows

---

## Performance Metrics

**v0.2.0 Velocity:**
- Total plans completed: 86
- Timeline: Jan 20 - Feb 1, 2026 (13 days)
- Average: 3.9 min/plan

**v0.3.0 Velocity:**
- Total plans completed: 5 (Phase 22)
- Timeline: Feb 6, 2026
- Average: ~4.5 min/plan

---

## Accumulated Context

### Decisions

**Stack Decisions:**
- Use `@modelcontextprotocol/sdk@1.26.0` for MCP integration (Phase 25)
- No additional observability packages needed — Effect's built-in logging + @effect/opentelemetry sufficient
- Effect TestClock for deterministic evaluation timing (Phase 23)

**Architecture Decisions:**
- Tool gating happens at discovery time, not execution time
- MCP clients modeled as Effect-managed resources with `Effect.acquireRelease`
- Observability designed as cross-cutting concern using Effect's `Effect.withSpan()`
- Evaluation traces use relative timings and stable identifiers for determinism
- Correlation context via Effect FiberRef with AsyncLocalStorage bridge (Phase 22-06)
- Effect.currentSpan provides span IDs, not raw @opentelemetry/api (Phase 22-06)
- Processor entry points activate correlation context with withCorrelationContext (Phase 22-07)
- Consumer files use Effect-based accessors in Effect.gen blocks for FiberRef accuracy (Phase 22-07)
- Deterministic runId-based sampling (1% success, 100% errors/slow) (Phase 22)
- Logger.json enabled by default for structured observability (Phase 22)
- Hash payloads by default to prevent sensitive data leakage (Phase 22)
- Hook outcome classification: five outcomes (executed/skipped/aborted/modified/error) (Phase 22)
- Token usage/cost tracked per run with pricing table from config (Phase 22)
- Golden traces exportable in JSON/Prometheus/OTel formats (Phase 22)
- Evaluation artifacts normalized with stable tuple IDs and relative timing only (Phase 23-01)
- Evaluation persistence abstracted behind TraceStorageService (Phase 23-01)
- Assertion suites now use Effect Schema-decoded typed specs with binary suite pass/fail semantics (Phase 23-02)
- Response assertions use hybrid matching: exact path checks + semantic similarity threshold (Phase 23-02)
- Comparator output is scorecard-first with normalize-before-diff and volatile-field filtering (Phase 23-02)
- Replay defaults to latest checkpoint when explicit `fromCheckpoint` is omitted (Phase 23-03)
- Replay hard-fails on missing/mismatched recorded tool mock responses (Phase 23-03)
- Replay determinism is validated by stable output hashes under Effect TestClock (Phase 23-03)
- Evaluation suite manifests decode from YAML/JSON through Effect Schema for deterministic validation (Phase 23-04)
- Intent metrics include union(expected, predicted) labels with `__none__` fallback for balanced confusion matrices (Phase 23-04)
- Compare/suite CLI outcomes use exit code 2 to differentiate regressions from invocation/runtime failures (Phase 23-05)
- Core package exposes `evaluation` top-level helper namespace for replay/compare/suite APIs (Phase 23-05)
 - CLI default eval record/replay/compare now execute core EvaluationService/replay/comparator flows instead of placeholders/deep-equal (Phase 23-06)
- Use Layer.provide chain instead of Layer.mergeAll for explicit dependency composition (Phase 23-07)
- Make configPath optional in replay dependencies to support artifact-only replay (Phase 23-07)
- Conditional runtime initialization in replay - only call initializeFromConfig when configPath is provided (Phase 23-07)
- Layer composition pattern: Use Layer.merge to combine dependencies, then Layer.provide(service, deps) to wire into service (Phase 23-09)
- Config-less replay mode: CLI replay works without Fred config file using artifact-only runtime (Phase 23-10)

**Safety Decisions:**
- Gate tools at discovery time (LLM never sees disallowed tools)
- All MCP tools pass through ToolGateService before being offered to LLM
- Audit logging via observability hooks for all policy decisions

### Blockers/Concerns

None.

---

## Session Continuity

Last session: 2026-02-06T21:58:37Z
Stopped at: Completed 23-10-PLAN.md
Resume: Execute .planning/phases/24-tool-access-control/24-01-PLAN.md

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-02-06 — Phase 23 complete (10/10 plans complete)*
