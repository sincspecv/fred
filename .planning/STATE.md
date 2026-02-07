# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.3.0 milestone — Phase 24 tool access control in progress
**Milestone:** v0.3.0 Observability & Safety (Phases 22-26)

---

## Current Position

**Phase:** 25 — MCP Integration
**Plan:** 6 of 6 plans complete
**Status:** Phase complete
**Last activity:** 2026-02-07 — Completed 25-06-PLAN.md (Fred class integration and public API wiring)

**Progress:** ████████████ 100% (115/115 plans complete)

| Phase | Name | Requirements | Plans | Status |
|-------|------|--------------|-------|--------|
| 22 | Observability Foundation | 8 | 8/8 | ✅ Complete |
| 23 | Evaluation Framework | 8 | 10/10 | ✅ Complete |
| 24 | Tool Access Control | 8 | 6/6 | ✅ Complete |
| 25 | MCP Integration | 10 | 6/6 | ✅ Complete |
| 26 | Routing Explainability | 3 | — | ⚪ Not started |

---

## Milestone History

**v0.3.0 — IN PROGRESS**
- Target: 5 phases (22-26)
- 35 requirements mapped
- Phase 22: ✅ Complete (2026-02-06)
- Phase 23: ✅ Complete (2026-02-06)
- Phase 24: ✅ Complete (2026-02-07)
- Next: Phase 25 (MCP Integration)

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

**MCP Integration Decisions (Phase 25):**
- MCP servers declared globally in config as Record<string, MCPGlobalServerConfig> (Phase 25-01)
- Agent mcpServers field accepts string[] (server ID refs) as primary format with MCPServerConfig[] for backward compat (Phase 25-01)
- Environment variable syntax ${ENV_VAR} resolves at config load time (Phase 25-01)
- MCP config validation is warn-only - log issues but never throw (Phase 25-01)
- MCP server defaults: enabled=true, lazy=false (auto-start), timeout=30000ms (Phase 25-01)
- MCP tool namespace format: server/tool (slash-separated) for collision-free discovery (Phase 25-02)
- MCPServerRegistry stores initialized clients with status tracking (connected/disconnected/error) (Phase 25-02)
- Effect.acquireRelease guarantees MCP client cleanup on shutdown or error via lifecycle.ts (Phase 25-02)
- Duplicate server registration rejected - same server ID cannot be registered twice (Phase 25-02)
- Health checks use configurable intervals: 30s default for stdio, 60s for http/sse (Phase 25-03)
- Auto-restart uses exponential backoff (1s, 2s, 4s) with 3 max retries (Phase 25-03)
- Health check stops after retry exhaustion to avoid wasting resources on failed servers (Phase 25-03)
- Tool re-discovery happens after successful reconnect to ensure fresh tool list (Phase 25-03)
- Lazy servers registered but not connected until first access via ensureConnected() (Phase 25-03)
- Graceful shutdown order: stop health checks, close clients, clear registry (Phase 25-03)
- Startup failures don't throw - warn and continue without that server (Phase 25-03)
- Failed servers NOT added to registry (getClient returns undefined, not null) (Phase 25-03)
- Resource service returns empty array + warning for disconnected servers (listResources) (Phase 25-04)
- Tool execution returns formatted error string instead of throwing for disconnected servers (Phase 25-04)
- discoverAllTools uses Effect.either to isolate per-server errors gracefully (Phase 25-04)
- AgentFactory uses MCPServerRegistry for MCP tool resolution, not inline clients (Phase 25-05)
- MCP tools pass through ToolGateService.filterTools at discovery time (Phase 25-05)
- Denied MCP tools never added to effectTools - LLM never sees them (Phase 25-05)
- Unknown server IDs log warning but don't crash agent creation (Phase 25-05)

**Safety Decisions:**
- Gate tools at discovery time (LLM never sees disallowed tools)
- All MCP tools pass through ToolGateService before being offered to LLM
- Audit logging via observability hooks for all policy decisions
- Policy DSL uses explicit default -> intent -> agent layering with override blocks for deterministic inheritance (Phase 24-01)
- Policy overrides must target explicit scopes and references must resolve at config load time (Phase 24-01)
- Contradictory allow/deny and deny/requireApproval declarations fail fast during config validation (Phase 24-01)
- Tool capability inference is deterministic with stable ordering across built-in and custom tags (Phase 24-02)
- Capability metadata preserves inferred vs manual tags while allowing additive manual extensions only (Phase 24-02)
- Matching tool policy overrides replace inherited default/intent/agent rule chains at runtime (Phase 24-03)
- Tool gate decisions evaluate deny precedence across layered scopes with matched-rule metadata for auditability (Phase 24-03)
- Tool policy updates are Ref-backed and applied immediately via setPolicies/reloadPolicies without cached stale decisions (Phase 24-03)
- Policy context from message processing is threaded into agent execution (intent/agent/conversation/user/role metadata) for runtime tool gating (Phase 24-04)
- AgentFactory applies per-invocation ToolGate filtering and returns explicit POLICY_DENIED records on blocked tool bypass attempts (Phase 24-04)
- Config initialization now applies extracted tool policies into ToolGateService for init/reload parity (Phase 24-04)
- Audit events emitted via hooks after policy decisions (not inline) for decoupled observability (Phase 24-05)
- Tool arguments hashed by default using ObservabilityService.hashPayload to prevent sensitive data leakage (Phase 24-05)
- Hook emission failures caught with Effect.catchAll to ensure gate decisions never fail due to audit issues (Phase 24-05)
- Approval is session-scoped (conversationId → userId → 'default') with no cross-conversation leakage (Phase 24-06)
- HITL trigger ONLY from explicit requireApproval policy flag, NOT automatic from capability tags (Phase 24-06)
- Deny-on-timeout with 5 minute default TTL for security-first approval requests (Phase 24-06)
- Approval/denial outcomes emit audit events via afterPolicyDecision hooks (Phase 24-06)

### Blockers/Concerns

None.

---

## Phase 25: MCP Integration — COMPLETE

**Status:** ✅ Complete (6/6 plans executed)
**Completed:** 2026-02-07

**What was built:**
- MCPGlobalServerConfig type with all transport fields (stdio, http, sse) (25-01)
- Global server config schema as Record<string, MCPGlobalServerConfig> in FrameworkConfig (25-01)
- extractMCPServers function with ${ENV_VAR} resolution and defaults (25-01)
- Warn-only MCP config validation (unknown servers, missing required fields) (25-01)
- Agent mcpServers field updated to accept string[] (server ID refs) or legacy MCPServerConfig[] (25-01)
- MCPServerRegistry with Effect.acquireRelease lifecycle and server/tool namespace format (25-02)
- MCPHealthManager with periodic health checks and exponential backoff auto-restart (25-03)
- Lazy server startup pattern with on-demand connection (25-03)
- Graceful shutdown with health check cleanup (25-03)
- Graceful startup failure handling (warn-only, no throw) (25-03)
- MCPResourceService for listing and reading resources from MCP servers (25-04)
- Enhanced tool discovery with graceful error handling (Effect.either per server) (25-04)
- Mid-conversation server failure resilience in tool execution (25-04)
- AgentFactory using MCPServerRegistry for MCP tool resolution (25-05)
- ToolGateService integration for MCP tool filtering at discovery time (25-05)
- Comprehensive MCP factory and gating tests (25-05)
- Fred class MCPServerRegistry and MCPResourceService integration (25-06)
- ConfigInitializer MCP server extraction and registration flow (25-06)
- Public API exports for MCP modules (registry, resource service, health manager) (25-06)
- Comprehensive integration test suite (15 tests covering config → registry → agent → tools flow) (25-06)

**Key achievements:**
- Environment variables resolve at config load time with fallback to literal values
- MCP config validation never blocks Fred startup (warn-only semantics)
- Agent config supports dual format for smooth migration path
- Effect-managed client lifecycle guarantees cleanup on shutdown or error
- Tool namespace format (server/tool) prevents collisions between servers
- Health checks with auto-restart ensure MCP servers recover transparently from crashes
- Exponential backoff (1s, 2s, 4s) balances recovery speed with resource usage
- Tool re-discovery after reconnection keeps agent tools fresh
- Lazy servers reduce startup time and resource usage
- Resource access gracefully handles disconnected servers
- MCP tools subject to same policy enforcement as native tools
- Denied MCP tools never reach the LLM
- Fred.initializeFromConfig automatically registers MCP servers from config
- Graceful shutdown order (MCP cleanup → agent cleanup → runtime cleanup)
- Public API exposes getMCPServerRegistry() and getMCPResourceService() for runtime management

---

## Phase 24: Tool Access Control — COMPLETE

**Status:** ✅ Complete (6/6 plans executed)
**Completed:** 2026-02-07

**What was built:**
- ToolPoliciesConfig schema with default/intent/agent layering and override blocks (24-01)
- Deterministic tool capability inference with stable ordering and additive manual extensions (24-02)
- ToolGateService with deny precedence evaluation and Ref-backed policy updates (24-03)
- Runtime tool gating in AgentFactory with policy context propagation and POLICY_DENIED records (24-04)
- Policy audit hook events (afterPolicyDecision) with hashed arguments and observability integration (24-05)
- HITL approval workflow with session-scoped tracking and deny-on-timeout pause signals (24-06)

**Key achievements:**
- Tool policies are declarative, deterministic, and hot-reloadable without stale decision caches
- Tool arguments never appear in raw form in audit logs (hashed via ObservabilityService)
- Gate decisions never fail due to audit emission (Effect.catchAll for fault tolerance)
- Backward compatible (works without HookManagerService/ObservabilityService)
- Session-scoped approval tracking prevents cross-conversation approval leakage
- requireApproval tools trigger HITL pause with security-first deny-on-timeout (5min TTL)

---

## Session Continuity

Last session: 2026-02-07T03:30:57Z
Stopped at: Completed 25-06-PLAN.md (Fred class integration and public API wiring - Phase 25 complete)
Resume file: None

---

## Phase 23: Evaluation Framework — COMPLETE

**Verification:** PASSED (8/8 success criteria + 3/3 gap closures verified)
**Report:** .planning/phases/23-evaluation-framework/23-VERIFICATION.md

**What was built:**
- Deterministic recording artifact pipeline with TraceStorageService abstraction
- Typed assertions library (tool call, routing, response, presence/absence assertions)
- Regression comparator with scorecard-first output and volatile-field filtering
- Checkpoint replay with mocked tools and Effect TestClock for determinism
- Batch suite runner with YAML/JSON manifest support and per-intent confusion matrices
- CLI commands (record/replay/compare/suite) exposed with consistent core-backed flows
- **Gap closure:** Layer composition bug fixed using proper Layer.provide chain
- **Gap closure:** Config-less replay mode for artifact-only validation workflows
- **Gap closure:** Suite CLI fully wired to core runner with complete SuiteReport (metrics, confusion matrix)

**Gap Closure Summary:**
| Plan | Issue | Fix |
|------|-------|-----|
| 23-09 | Record throws "ObservabilityService not found" | Fixed Layer.provide(EvaluationServiceLive, deps) pattern |
| 23-10 | Replay requires config file | Artifact-only runtime without config dependency |
| 23-11 | Suite doesn't return aggregate metrics | Full SuiteReport with totals, latency, tokenUsage, intentQuality |

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-02-07 — Phase 25 complete (6/6 plans)*
