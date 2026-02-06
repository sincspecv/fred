# Roadmap: Fred

## Overview

Fred's roadmap tracks the evolution of the framework from Effect-based foundation through observability, safety, and integration features.

**Current Milestone:** v0.3.0 Observability & Safety (Phases 22-26)
**Previous Milestone:** v0.2.0 Effect Migration + Monorepo (Phases 1-21.1, shipped 2026-02-01)
**Total Requirements:** 35 v1 requirements mapped to phases
**Depth:** Comprehensive

---

## Milestones

- ✅ **v0.2.0 Effect Migration + Monorepo** — Phases 1-21.1 (shipped 2026-02-01)
- 🔵 **v0.3.0 Observability & Safety** — Phases 22-26 (in progress)
- ⚪ **v0.3.1 CLI/TUI Developer Experience** — Planned after v0.3.0

---

## Phases

<details>
<summary>✅ v0.2.0 Effect Migration + Monorepo (Phases 1-21.1) — SHIPPED 2026-02-01</summary>

See: `.planning/milestones/v0.2.0-ROADMAP.md` for full details

- [x] Phase 1: Provider + Tool Foundation (3/3 plans) — completed 2026-01-23
- [x] Phase 2: Agent Registration + Shared Memory (2/2 plans) — completed 2026-01-24
- [x] Phase 3: Core Routing with Fallback (2/2 plans) — completed 2026-01-24
- [x] Phase 4: Entry Routing + Dev Chat (2/2 plans) — completed 2026-01-24
- [x] Phase 5: Sequential Pipelines + Hooks (4/4 plans) — completed 2026-01-24
- [x] Phase 6: Graph Workflows + Agent Handoff (5/5 plans) — completed 2026-01-24
- [x] Phase 7: Provider Pack Extensibility (6/6 plans) — completed 2026-01-24
- [x] Phase 8: SQL Persistence Adapters (5/5 plans) — completed 2026-01-24
- [x] Phase 9: Checkpoint + Resume (4/4 plans) — completed 2026-01-24
- [x] Phase 10: Human-in-the-Loop Pauses (4/4 plans) — completed 2026-01-25
- [x] Phase 11: OTel-Compatible Observability (4/4 plans) — completed 2026-01-25
- [x] Phase 12: Groq + OpenRouter Providers (3/3 plans) — completed 2026-01-25
- [x] Phase 13: True Streaming Multi-Step (3/3 plans) — completed 2026-01-26
- [x] Phase 14: Effect runMain Entry Points (2/2 plans) — completed 2026-01-30
- [x] Phase 15: Effect Services Internal + Dual API (12/12 plans) — completed 2026-01-31
- [x] Phase 16: Effect Service Patterns (5/5 plans) — completed 2026-01-31
- [x] Phase 17: Fix Tool Schema Types and Calculator Validation (3/3 plans) — completed 2026-01-31
- [x] Phase 18: Wire StreamResult to Public API (2/2 plans) — completed 2026-01-31
- [x] Phase 19: Fix Remaining TypeScript Errors (7/7 plans) — completed 2026-01-31
- [x] Phase 20: Tool Reliability Improvements (1/1 plans) — completed 2026-01-31
- [x] Phase 21: Monorepo Conversion (6/6 plans) — completed 2026-02-01
- [x] Phase 21.1: Automatic Package Publishing (1/1 plans) — completed 2026-02-01

</details>

---

## Phase 22: Observability Foundation

**Milestone:** v0.3.0
**Goal:** Developers can observe and debug agent runs with correlation IDs, spans, and structured logs integrated with their existing monitoring stack.
**Status:** ✅ Complete (gap closure verified 2026-02-06)

**Requirements Covered:** OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07, OBS-08

**Dependencies:**
- Previous phases (1-21.1): Core framework, hooks system, persistence
- No new external dependencies beyond existing @effect/opentelemetry

**Success Criteria:**

1. **Developer can register a lifecycle hook that receives correlation context** (OBS-01)
   - Hook callback receives object with `runId`, `conversationId`, `intentId`, `timestamp`, `agentId`
   - Context propagates across async boundaries in pipeline execution
   - Multiple hooks can be registered and all receive the same context

2. **Structured JSON logs are emitted with correlation IDs** (OBS-02)
   - Log entries contain `traceId`, `spanId`, `parentSpanId` fields
   - Logs include `service.name="fred"`, `service.version` attributes
   - Logs can be ingested by Datadog/Honeycomb/LangSmith without transformation

3. **OTel-compatible spans track agent runs with trace propagation** (OBS-03)
   - Each agent run creates a root span with child spans per pipeline step
   - Span attributes include model name, temperature, token counts
   - Traces can be exported to Jaeger/Zipkin/OTLP collectors

4. **Token usage and model costs are tracked per run** (OBS-04)
   - Metrics show prompt_tokens, completion_tokens, total_tokens per run
   - Cost estimation available via configured pricing table ($/1K tokens)
   - Metrics exportable as Prometheus/OpenTelemetry format

5. **Traces are tagged with intent classification for analysis** (OBS-05)
   - Spans include `intent.id`, `intent.confidence`, `intent.matched_pattern` attributes
   - Intent classification failures create distinct span events
   - Trace queries can filter by intent type for pattern analysis

6. **Pipeline step execution is visible in trace tree** (OBS-06)
   - Each pipeline step creates a child span with step name and duration
   - Conditional branches create spans for taken and not-taken paths
   - Agent handoffs create linked spans showing cross-agent flow

7. **Hook telemetry tracks skip/abort/modify frequency** (OBS-07)
   - Metrics count `hook.executed`, `hook.skipped`, `hook.aborted`, `hook.modified` events
   - Per-hook-type metrics show which hooks fire most frequently
   - Telemetry excludes sensitive data (message content is hashed)

8. **Golden traces can be exported from hook events** (OBS-08)
   - Hook provides `exportTrace(traceId)` method returning full trace object
   - Export includes spans, events, attributes, and timing data
   - Format is JSON-serializable and versioned for compatibility

**Deliverables:**
- `ObservabilityService` with structured event recording
- Hook-to-observability bridge for automatic event emission
- Trace correlation across async boundaries
- Configurable sampling and filtering for production scale

**Plans:** 8 plans (8/8 complete, including 3 gap closure)

Plans:
- [x] 22-01-PLAN.md — Observability core primitives and config wiring
- [x] 22-02-PLAN.md — Hook correlation context + telemetry bridge
- [x] 22-03-PLAN.md — Message processing correlation + intent tagging
- [x] 22-04-PLAN.md — Pipeline/graph span and branch instrumentation
- [x] 22-05-PLAN.md — Metrics capture + golden trace export
- [x] 22-06-PLAN.md — [GAP] Rewrite correlation context with FiberRef + ALS bridge
- [x] 22-07-PLAN.md — [GAP] Wire context into processor + update consumer files
- [x] 22-08-PLAN.md — [GAP] Update exports + integration test

**Research Flags:** None — well-documented OpenTelemetry patterns, Effect has built-in support

---

## Phase 23: Evaluation Framework

**Milestone:** v0.3.0
**Goal:** Developers can record, replay, and compare agent runs to detect regressions and validate behavior deterministically.
**Status:** 🔄 Gap closure in progress (UAT diagnosed 2026-02-06)

**Requirements Covered:** EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, EVAL-08

**Dependencies:**
- Phase 22 (Observability): Trace capture and correlation IDs
- Previous: Checkpoint/resume system, persistence adapters

**Success Criteria:**

1. **Developer can record golden traces with full execution context** (EVAL-01)
   - Recording API: `fred.eval.record(runId)` captures complete execution
   - Trace includes messages, tool calls, routing decisions, model outputs
   - Recording can be triggered programmatically or via auto-capture rules

2. **Assertion library validates traces** (EVAL-02)
   - Assertions check tool call presence/absence, argument values, response content
   - Routing assertions verify intent classification and agent selection
   - Assertion failures provide detailed diffs showing expected vs actual

3. **Two runs can be compared for regressions** (EVAL-03)
   - `fred.eval.compare(traceA, traceB)` highlights differences in routing, tools, outputs
   - Comparison ignores non-deterministic fields (timestamps, trace IDs)
   - Regression report shows pass/fail per assertion with severity levels

4. **Batch evaluation runs test suites with aggregated reporting** (EVAL-04)
   - Test suites defined in YAML/JSON with multiple test cases
   - Batch runner executes all cases and produces aggregated pass/fail stats
   - Reports include per-intent accuracy, average latency, token usage trends

5. **Intent-level evaluation measures per-intent accuracy** (EVAL-05)
   - Metrics track true positives, false positives, false negatives per intent
   - Intent confusion matrix shows which intents get misclassified
   - Accuracy scores can be compared across agent versions

6. **Pipeline can be replayed from any checkpoint** (EVAL-06)
   - Replay API accepts trace ID and checkpoint index to resume from
   - Replay uses recorded checkpoint state to restore conversation context
   - Resuming from checkpoint produces identical subsequent behavior

7. **Tool calls are mocked during replay** (EVAL-07)
   - Tool responses are replayed from recorded trace instead of executing
   - Mock layer intercepts tool calls and returns recorded responses
   - Deterministic replay verified: same input → identical output hash

8. **Effect TestClock enables deterministic timing** (EVAL-08)
   - Replay uses TestClock to eliminate timing-dependent behavior
   - Time-based operations (delays, timeouts) use recorded offsets
   - Tests using TestClock produce identical results across runs

**Deliverables:**
- `EvaluationService` for recording and replay
- `TraceStorageService` abstraction (file/SQL persistence)
- Deterministic trace format with environment context
- CLI commands: `fred eval record`, `fred eval replay`, `fred eval compare`
- Tool mocking layer for deterministic replay

**Plans:** 8 plans (6/8 complete, including 3 gap closure)

Plans:
- [x] 23-01-PLAN.md — Build deterministic recording artifact pipeline + TraceStorageService abstraction
- [x] 23-02-PLAN.md — Implement typed assertions and normalized regression comparator
- [x] 23-03-PLAN.md — Build checkpoint replay with mocked tools and Effect TestClock
- [x] 23-04-PLAN.md — Add batch suite runner and per-intent confusion-matrix metrics
- [x] 23-05-PLAN.md — Expose eval workflows via CLI commands and public core exports
- [x] 23-06-PLAN.md — [GAP] Wire default CLI eval flows to core EvaluationService/comparator APIs
- [ ] 23-07-PLAN.md — [GAP] Fix record layer provisioning and add config-less replay checkpoint path
- [ ] 23-08-PLAN.md — [GAP] Replace default suite placeholder with core-backed suite + diagnostics and full default-path regression coverage

**Research Flags:**
- Complex domain around trace format design
- May need validation of determinism approach with real-world traces
- Run traces through multiple environments (CI, local, different machines) before finalizing

---

## Phase 24: Tool Access Control

**Milestone:** v0.3.0
**Goal:** Developers can define and enforce fine-grained tool access policies based on intent, user roles, and context with full audit trails.
**Status:** ⚪ Not Started

**Requirements Covered:** GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-07, GATE-08

**Dependencies:**
- Phase 22 (Observability): Audit logging via hooks
- Phase 23 (Evaluation): Deterministic policy validation
- Previous: Tool registry, HITL pause/resume

**Success Criteria:**

1. **Developer can define tool allowlists per intent and per agent** (GATE-01)
   - Policy config specifies allowed tools per intent: `intent: "search" → tools: ["web_search", "calculator"]`
   - Agent-level policies override defaults: `agent: "math" → tools: ["calculator", "wolfram"]`
   - Policies are validated at config load time for consistency

2. **Tools are categorized with permission levels** (GATE-02)
   - Built-in categories: `read`, `write`, `admin`, `external`, `expensive`, `destructive`
   - Tools auto-tagged with capabilities based on schema analysis
   - Categories are extensible via policy config

3. **Policies are evaluated at runtime based on context** (GATE-03)
   - Policy engine receives `userId`, `role`, `intent`, `toolId`, `arguments` context
   - Rules support conditions: `if: role == "admin" then: allow`
   - Evaluation is deterministic and logged for audit

4. **Sensitive tool calls trigger HITL pause** (GATE-04)
   - Tools tagged `destructive` or `admin` trigger approval workflow
   - Pause includes context: which agent, which intent, what arguments
   - Human approver/denier identity is logged with decision

5. **All policy decisions are logged via observability hooks** (GATE-05)
   - Hook events include `policy.decision`, `policy.denied`, `policy.approved`
   - Logs include full context (user, intent, tool, rule that triggered)
   - Audit trail is tamper-evident (immutable once written)

6. **Intent-aware policies apply different permissions** (GATE-06)
   - Same tool can have different policies per intent
   - Example: `calculator` allowed for "math" intent, denied for "chat" intent
   - Intent classification happens before policy evaluation

7. **Policy inheritance with override support** (GATE-07)
   - Hierarchy: default → intent → agent-level
   - Child policies can override parent with explicit `override: true`
   - Conflicts are detected and reported at config validation

8. **Tools are auto-tagged with capabilities** (GATE-08)
   - Tags inferred from operation names: `delete_*` → `destructive`
   - Tags inferred from schemas: external API calls → `external`
   - Manual tags can supplement auto-detection

**Deliverables:**
- `ToolGateService` with access control logic
- `IntentContextService` for context propagation
- Data-driven policy DSL (YAML/JSON configurable)
- Audit logging integration with observability hooks
- HITL integration for approval workflows

**Research Flags:**
- Start with simple allowlist/denylist; add context-aware rules based on real usage
- Established patterns from Continue.dev, OpenClaw; schema-based policies are straightforward

---

## Phase 25: MCP Integration

**Milestone:** v0.3.0
**Goal:** Developers can discover and use tools from external MCP servers with automatic lifecycle management and safety policies applied.
**Status:** ⚪ Not Started

**Requirements Covered:** INTG-01, INTG-02, INTG-03, INTG-04, INTG-05, INTG-06, INTG-07, INTG-08, INTG-09, INTG-10

**Dependencies:**
- Phase 22 (Observability): Debugging and tracing for MCP calls
- Phase 23 (Evaluation): Testing MCP tool interactions
- Phase 24 (Tool Gating): Safety policies for external tools
- New dependency: `@modelcontextprotocol/sdk@1.26.0`

**Success Criteria:**

1. **Fred supports MCP protocol 2024-11-05** (INTG-01)
   - Implements protocol version 2024-11-05 specification
   - Supports protocol negotiation with servers
   - Error handling follows MCP standard error codes

2. **MCP servers connect via stdio transport** (INTG-02)
   - Config specifies command and args: `command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"]`
   - Subprocess spawned and managed via Effect resource scoping
   - Stdio transport supports bidirectional JSON-RPC

3. **MCP servers connect via HTTP/SSE transport** (INTG-03)
   - Remote servers configured with URL: `url: "https://mcp.example.com/sse"`
   - SSE transport handles server-sent events for async notifications
   - HTTP transport supports authentication headers

4. **Tools from MCP servers are discovered** (INTG-04)
   - `tools/list` method returns all available tools with schemas
   - Tool schemas converted to Effect Schema for validation
   - Discovery happens at server connection time and can be refreshed

5. **MCP tools execute through standard protocol** (INTG-05)
   - Tool calls use `tools/call` method with argument validation
   - Responses include content, errors, and metadata
   - Execution timeout and retry logic configurable

6. **MCP resources are accessible** (INTG-06)
   - `resources/list` and `resources/read` methods supported
   - Resource content accessible to agents via resource URI
   - Resource updates trigger notifications where supported

7. **MCP tools adapted as native Fred tools** (INTG-07)
   - MCP tools appear in Fred tool registry with namespaced IDs
   - Tool schemas are compatible with Fred's Effect Schema format
   - Agents can call MCP tools transparently like native tools

8. **Intent-aware routing directs requests to MCP servers** (INTG-08)
   - Routing rules can specify MCP server for specific intents
   - Example: `intent: "file_search" → server: "filesystem-mcp"`
   - Multiple servers can serve same intent with fallback ordering

9. **Multiple MCP servers supported with namespaced tool IDs** (INTG-09)
   - Tool IDs are namespaced: `{server-name}/{tool-name}`
   - Namespace prevents collisions between servers
   - Developer can alias tools for convenience

10. **Tool gating policies apply to MCP-discovered tools** (INTG-10)
    - All MCP tools pass through ToolGateService before being offered to LLM
    - Gating happens at discovery time (LLM never sees disallowed tools)
    - Policy violations are logged with MCP server context

**Deliverables:**
- `MCPServerService` with multi-server management
- `MCPResourceService` for resource handling
- MCP tool bridge for seamless Fred integration
- Lifecycle management (auto-start/stop, health checks)
- Configuration schema for YAML/JSON MCP server definitions
- Integration with tool gating policies

**Research Flags:**
- MCP ecosystem is evolving rapidly; may need research on specific server behaviors
- Test against multiple real MCP servers during implementation
- Validate adapter handles edge cases

---

## Phase 26: Routing Explainability

**Milestone:** v0.3.0
**Goal:** Developers and users can understand why specific routing decisions were made with confidence scores and alternative explanations.
**Status:** ⚪ Not Started

**Requirements Covered:** ROUT-04, ROUT-05, ROUT-06

**Dependencies:**
- Phase 22 (Observability): Hook infrastructure for routing metadata
- Previous: Intent routing system, hybrid classifier

**Success Criteria:**

1. **Routing decisions include match scores and classification rationale** (ROUT-04)
   - Intent result includes `confidence` score (0.0-1.0)
   - Result includes `rationale` explaining classification reasoning
   - Result includes `alternatives` array with top N other intents and scores

2. **Routing metadata accessible via observability hooks** (ROUT-05)
   - Hook events include `routing.decision` with full metadata
   - Metadata includes classified intent, confidence, matched pattern/rule
   - Alternative routing paths are logged for debugging

3. **Developer can query why an agent was selected** (ROUT-06)
   - API: `fred.routing.explain(message)` returns routing explanation
   - Explanation shows: intent classification → routing rule → selected agent
   - Debug mode shows all candidate agents with scores and rejection reasons

**Deliverables:**
- Routing decision metadata in traces
- Intent match confidence tracking
- Alternative routing explanations
- Debug mode for routing decisions
- `fred.routing.explain()` API

**Research Flags:** None — builds on Phase 22, minimal new research needed

---

## Phase Dependencies

```
Phase 22 (Observability)
    ↓
Phase 23 (Evaluation) — depends on trace capture
    ↓
Phase 24 (Tool Gating) — depends on hooks for audit logging
    ↓
Phase 25 (MCP Integration) — depends on tool registry and gating
    ↓
Phase 26 (Routing Explainability) — depends on observability hooks
```

All phases benefit from the v0.2.0 foundation: intent routing, pipelines, persistence, HITL.

---

## Progress Tracking

| Phase | Milestone | Requirements | Success Criteria | Status |
|-------|-----------|--------------|------------------|--------|
| 1-21.1 | v0.2.0 | 17 | 17 | ✅ Complete |
| 22 - Observability Foundation | v0.3.0 | 8 (OBS-01→08) | 8 | ✅ Complete |
| 23 - Evaluation Framework | v0.3.0 | 8 (EVAL-01→08) | 8 | ✅ Complete |
| 24 - Tool Access Control | v0.3.0 | 8 (GATE-01→08) | 8 | ⚪ Not Started |
| 25 - MCP Integration | v0.3.0 | 10 (INTG-01→10) | 10 | ⚪ Not Started |
| 26 - Routing Explainability | v0.3.0 | 3 (ROUT-04→06) | 3 | ⚪ Not Started |
| **Total v0.3.0** | — | **35** | **35** | **In Progress** |

---

## Coverage Summary

| Category | Requirements | Phase | Status |
|----------|--------------|-------|--------|
| Observability | OBS-01 to OBS-08 | 22 | Complete |
| Evaluation & Replay | EVAL-01 to EVAL-08 | 23 | Complete |
| Tool Gating | GATE-01 to GATE-08 | 24 | Not Started |
| MCP Integration | INTG-01 to INTG-10 | 25 | Not Started |
| Routing Explainability | ROUT-04 to ROUT-06 | 26 | Not Started |

**Coverage: 35/35 v0.3.0 requirements mapped** ✓
**All v1 requirements assigned to exactly one phase** ✓
**No orphaned requirements** ✓

---

## Anti-Features (Out of Scope)

These features are explicitly excluded from v0.3.0:

| Feature | Reason |
|---------|--------|
| Custom observability protocol | Use OpenTelemetry standard instead of reinventing |
| Observability UI/dashboard in core | Belongs in separate tools (LangSmith, Honeycomb) |
| Automatic "flakiness" tolerance | Hiding instability reduces quality; fix root causes |
| Production replay with real side effects | Replay must be read-only with mocked tools |
| MCP server implementation | Don't compete with MCP ecosystem; focus on client |
| Evaluation UI in core | Evaluation dashboards are separate products |
| Complex RBAC initially | Start simple, add complexity only when needed |
| Dynamic code execution in policies | Security risk; declarative rules only |
| Automatic MCP tool registration without review | MCP servers can expose dangerous tools |
| Hidden MCP tool calls | Transparency critical; log all calls via hooks |

---

## Risk Mitigation

From research synthesis, key risks and mitigations:

1. **MCP client lifecycle not tied to Effect resource management**
   - Mitigation: Model MCP clients as Effect-managed resources with `Effect.acquireRelease`

2. **Evaluation traces capture implementation details**
   - Mitigation: Use relative timings, stable identifiers, sanitize machine-specific data

3. **Intent-aware tool gating as post-hoc filter**
   - Mitigation: Gate at tool discovery time, not execution time

4. **Observability creates circular dependencies**
   - Mitigation: Use Effect dependency injection; observability is a Layer provided to the system

5. **Observability data volume overwhelms backends**
   - Mitigation: Implement intelligent sampling (1% success, 100% errors, 100% slow requests)

---

## Completion Criteria for v0.3.0

Fred v0.3.0 is complete when:

- [ ] All 35 requirements have passing tests
- [ ] All 35 success criteria are observable in user workflows
- [ ] Observability hooks integrate with at least 3 backends (OTLP, console, file)
- [ ] Evaluation framework can record and replay a complex multi-agent pipeline
- [ ] Tool gating blocks unauthorized tool access with audit trail
- [ ] MCP integration connects to at least 2 reference servers (stdio + HTTP)
- [ ] Routing explanations show confidence scores and alternatives
- [ ] Documentation covers all new APIs with examples
- [ ] No breaking changes to v0.2.0 Promise-based APIs

---

*Roadmap tracking begins at v0.2.0 milestone*
*Last updated: 2026-02-06 — Phase 23 gap closure plans added from diagnosed UAT*
*Next: `/gsd/execute-phase 23 --gaps-only` to close diagnosed UAT gaps*
