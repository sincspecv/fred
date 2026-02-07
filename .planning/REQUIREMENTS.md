# Requirements: Fred v0.3.0

**Defined:** 2026-02-06
**Core Value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.

## v1 Requirements

Requirements for v0.3.0 milestone. Each maps to roadmap phases.

### Observability (OBS)

- [x] **OBS-01**: Developer can register lifecycle hooks that receive correlation context (runId, conversationId, intentId)
- [x] **OBS-02**: Hook events emit structured JSON logs with correlation IDs for monitoring systems
- [x] **OBS-03**: Agent runs produce OTel-compatible spans with trace propagation across pipeline steps
- [x] **OBS-04**: System tracks token usage and model costs per run with exportable metrics
- [x] **OBS-05**: Traces are tagged with intent classification for pattern analysis
- [x] **OBS-06**: Pipeline step execution is visible in trace tree with conditional branch tracking
- [x] **OBS-07**: Hook result telemetry tracks skip/abort/modify frequency per hook type
- [x] **OBS-08**: Golden traces can be exported from hook events for evaluation dataset creation

### Evaluation & Replay (EVAL)

- [x] **EVAL-01**: Developer can record golden traces of agent runs with full execution context
- [x] **EVAL-02**: Assertion library validates traces for tool calls, routing decisions, and responses
- [x] **EVAL-03**: Two runs can be compared to detect regressions in routing, tools, or outputs
- [x] **EVAL-04**: Batch evaluation runs test suites against agent versions with aggregated reporting
- [x] **EVAL-05**: Intent-level evaluation measures per-intent accuracy independently
- [x] **EVAL-06**: Pipeline can be replayed from any checkpoint in a recorded run
- [x] **EVAL-07**: Tool calls are mocked during replay using recorded responses for determinism
- [x] **EVAL-08**: Effect TestClock enables deterministic timing in evaluations

### Tool Gating (GATE)

- [x] **GATE-01**: Developer can define tool allowlists per intent and per agent
- [x] **GATE-02**: Tools are categorized with permission levels (read/write/admin)
- [x] **GATE-03**: Policies are evaluated at runtime based on request context and user roles
- [x] **GATE-04**: Sensitive tool calls trigger HITL pause for human approval
- [x] **GATE-05**: All policy decisions are logged via observability hooks for audit trails
- [x] **GATE-06**: Intent-aware policies apply different permissions based on classified intent
- [x] **GATE-07**: Policy inheritance allows default → intent → agent-level overrides
- [x] **GATE-08**: Tools are auto-tagged with capabilities (destructive, expensive, external)

### MCP Integration (INTG)

- [x] **INTG-01**: Fred supports MCP protocol 2024-11-05 for tool discovery and execution
- [x] **INTG-02**: MCP servers connect via stdio transport as subprocesses
- [x] **INTG-03**: MCP servers connect via HTTP/SSE transport for remote servers
- [x] **INTG-04**: Tools from MCP servers are discovered and listed with full schema
- [x] **INTG-05**: MCP tools execute through the standard protocol with argument validation
- [x] **INTG-06**: MCP resources are accessible through resource reading endpoints
- [x] **INTG-07**: MCP tools are adapted as native Fred tools in the tool registry
- [x] **INTG-08**: Intent-aware routing directs requests to appropriate MCP servers
- [x] **INTG-09**: Multiple MCP servers are supported with namespaced tool IDs
- [x] **INTG-10**: Tool gating policies apply to MCP-discovered tools

### Routing Explainability (ROUT)

- [x] **ROUT-04**: Routing decisions include match scores and classification rationale
- [x] **ROUT-05**: Routing metadata is accessible via observability hooks
- [x] **ROUT-06**: Developer can query why a specific agent was selected for a message

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Evaluation

- **EVAL-09**: LLM-as-judge for output quality evaluation
- **EVAL-10**: Web-based evaluation dashboard
- **EVAL-11**: Golden trace marketplace for sharing datasets

### MCP Integration

- **INTG-11**: Full MCP prompts capability support
- **INTG-12**: MCP resource subscription for real-time updates
- **INTG-13**: MCP server marketplace integration

### Tool Gating

- **GATE-09**: Policy simulation mode (dry-run without blocking)
- **GATE-10**: Complex RBAC with role hierarchies
- **GATE-11**: Geographic/time-based policy restrictions

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

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

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | Phase 22 | Complete |
| OBS-02 | Phase 22 | Complete |
| OBS-03 | Phase 22 | Complete |
| OBS-04 | Phase 22 | Complete |
| OBS-05 | Phase 22 | Complete |
| OBS-06 | Phase 22 | Complete |
| OBS-07 | Phase 22 | Complete |
| OBS-08 | Phase 22 | Complete |
| EVAL-01 | Phase 23 | Complete |
| EVAL-02 | Phase 23 | Complete |
| EVAL-03 | Phase 23 | Complete |
| EVAL-04 | Phase 23 | Complete |
| EVAL-05 | Phase 23 | Complete |
| EVAL-06 | Phase 23 | Complete |
| EVAL-07 | Phase 23 | Complete |
| EVAL-08 | Phase 23 | Complete |
| GATE-01 | Phase 24 | Complete |
| GATE-02 | Phase 24 | Complete |
| GATE-03 | Phase 24 | Complete |
| GATE-04 | Phase 24 | Complete |
| GATE-05 | Phase 24 | Complete |
| GATE-06 | Phase 24 | Complete |
| GATE-07 | Phase 24 | Complete |
| GATE-08 | Phase 24 | Complete |
| INTG-01 | Phase 25 | Complete |
| INTG-02 | Phase 25 | Complete |
| INTG-03 | Phase 25 | Complete |
| INTG-04 | Phase 25 | Complete |
| INTG-05 | Phase 25 | Complete |
| INTG-06 | Phase 25 | Complete |
| INTG-07 | Phase 25 | Complete |
| INTG-08 | Phase 25 | Complete |
| INTG-09 | Phase 25 | Complete |
| INTG-10 | Phase 25 | Complete |
| ROUT-04 | Phase 26 | Complete |
| ROUT-05 | Phase 26 | Complete |
| ROUT-06 | Phase 26 | Complete |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-07 — Phase 26 requirements marked complete, v0.3.0 all 35/35 requirements complete*
