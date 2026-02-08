# Fred

## What This Is

Fred is an OSS framework for building intent-based, multi-agent AI workflows with a single entrypoint that routes messages to specialized agents. Built on Effect (@effect/ai), it provides global shared context, in-memory conversation persistence with optional SQL-backed storage (Postgres/SQLite), and pipeline execution that chains agents or custom functions while preserving full context. The framework supports both Promise-based and Effect-based APIs, with pluggable provider packs for OpenAI, Anthropic, Google, Groq, and OpenRouter.

## Core Value

Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.

## Requirements

### Validated

- ✓ **ROUT-01**: Hybrid intent routing (rules/regex first, LLM fallback classifier) — v0.2.0
- ✓ **ROUT-02**: Unmatched messages route to default agent — v0.2.0
- ✓ **ROUT-03**: Multiple root agents for entry routing — v0.2.0
- ✓ **AGNT-01**: Agent registration with system prompt, model, and tool bindings — v0.2.0
- ✓ **ORCH-01**: Sequential pipeline execution with shared context — v0.2.0
- ✓ **ORCH-02**: Graph/DAG workflows for branching execution — v0.2.0
- ✓ **ORCH-03**: Pipeline hooks at before/after stages — v0.2.0
- ✓ **ORCH-04**: Agent handoff during workflow runs — v0.2.0
- ✓ **TOOL-01**: Schema-validated tool definitions — v0.2.0
- ✓ **PROV-01**: Effect provider abstraction (@effect/ai) — v0.2.0
- ✓ **PROV-02**: Pluggable provider packs — v0.2.0
- ✓ **PROV-03**: Streaming responses (tokens/steps) — v0.2.0
- ✓ **MEM-01**: In-memory conversation context with thread IDs — v0.2.0
- ✓ **PERS-01**: SQL persistence adapters (Postgres/SQLite) — v0.2.0
- ✓ **PERS-02**: Pipeline checkpoint and resume — v0.2.0
- ✓ **PERS-03**: Human-in-the-loop pauses and resume — v0.2.0
- ✓ **DX-01**: Interactive dev chat via `bun run dev` — v0.2.0
- ✓ **OBS-01**: Structured observability hooks for agent runs — v0.3.0
- ✓ **OBS-02**: Evaluation and replay tooling for historical runs — v0.3.0
- ✓ **SAFE-01**: Intent-aware tool gating policies — v0.3.0
- ✓ **INTG-01**: MCP server integration for external tool discovery — v0.3.0
- ✓ **ROUT-04**: Routing explainability metadata (match scores, rationale) — v0.3.0

### Active (v0.3.1)

- [ ] **DX-02**: CLI/TUI-first developer workflow for Fred projects
- [ ] **DX-03**: Project auto-detection and config validation in CLI startup
- [ ] **DX-04**: Command parity between TUI and non-interactive CLI mode
- [ ] **DX-05**: Extensible CLI plugin architecture for project-specific tooling

### Out of Scope

| Feature | Reason |
|---------|--------|
| Autonomous agents without guardrails | Unbounded cost and safety risk; prefer intent gating + HITL |
| Hidden tool calls by default | Reduces trust and debuggability; require explicit tool policies |
| Single mega-agent for all intents | Avoids specialization and undermines routing strategy |
| Always-on long-term memory | Privacy/cost risks; require explicit persistence adapter |
| AI SDK compatibility layer | Full migration to Effect complete; no backward compatibility needed |
| Mobile SDKs | Focus on framework core and server/library modes first |
| Non-TypeScript runtimes | Bun-compatible TypeScript is the target |

## Current State

**Shipped:** v0.3.0 (2026-02-07)
- 35/35 v0.3.0 requirements complete
- 5 phases delivered (22-26)
- 34 plans executed
- 111 files changed in milestone range
- 1,277/1,307 tests passing at audit time (pre-existing 30 failures outside milestone scope)

**Architecture:**
- Monorepo with Bun workspaces
- Effect-based internals with dual Promise/Effect APIs
- 5 built-in provider packs (OpenAI, Anthropic, Google, Groq, OpenRouter)
- SQL persistence (Postgres/SQLite)
- Checkpoint/resume with human-in-the-loop
- OTel-compatible observability

**Next Milestone Goals (v0.3.1):**
- TUI-first experience with OpenCode-style interface
- CLI command parity for scripting and automation
- Project auto-detection and config validation
- Plugin architecture for extensibility

## Context

- Effect-based architecture with @effect/ai providers
- Monorepo: 8 packages with independent versioning via Changesets
- ~50,000 LOC TypeScript across packages
- Bun runtime with TypeScript project references
- CI/CD with automatic npm publishing via GitHub Actions
- v0.3.0 adds observability services, deterministic evaluation/replay, tool policy gating, MCP integration, and routing explainability APIs

## Constraints

- **Runtime**: Bun-compatible — project runs on Bun and Node
- **Language**: TypeScript-only — core library is TS-first
- **AI SDK**: Full Effect replacement — no Vercel AI SDK dependencies
- **Persistence**: In-memory by default; SQL optional — no persistence without explicit adapter

## Current Milestone: v0.3.1 CLI/TUI Developer Experience

**Goal:** Transform `@fancyrobot/fred-cli` into a production-grade CLI + TUI that any Fred project can install and instantly use.

**Target features:**
- OpenCode-style TUI with sidebar, streaming transcript, inspector panel, and keyboard-first interaction
- Full CLI command parity (`fred run`, `fred init`, `fred dev`, `fred providers`, `fred tools`, `fred sessions`, `fred export`)
- Project auto-detection with `fred.config.ts`/`.json` support and high-quality validation errors
- Extensible plugin architecture for commands, TUI panels, config schemas, and runtime hooks
- Effect Layers throughout (ConfigService, ProjectRootService, ProviderRegistry, SessionStore, Runner, UIAdapter)
- Persistent sessions with export to Markdown/JSON

## Previous Milestone: v0.3.0 Observability & Safety

**Status:** ✅ Shipped 2026-02-07
**Archive:** `.planning/milestones/v0.3.0-ROADMAP.md`, `.planning/milestones/v0.3.0-REQUIREMENTS.md`

**Delivered:**
- Structured observability with correlation context, token/cost metrics, and trace export
- Deterministic record/replay/compare/suite evaluation framework
- Intent-aware tool gating with audit hooks and HITL approvals
- MCP server lifecycle + tool/resource integration under safety policies
- Routing explainability with confidence alternatives and `fred.routing.explain()`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid routing (rules + model fallback) | Explicit routing first, LLM fallback for flexibility | ✓ Good — Predictable with flexibility |
| Hybrid DX (config + programmatic API) | Support quick start and advanced overrides | ✓ Good — Both patterns well-used |
| Provider packs via Effect | Align provider integrations with Effect ecosystem | ✓ Good — 5 packs, clean abstractions |
| SQL support (Postgres + SQLite) | Cover production and local/dev needs | ✓ Good — Both adapters working |
| Effect Schema for tool validation | Better type safety and runtime validation | ✓ Good — All tools validated |
| Dual API (Promise + Effect) | Maintain Promise ease, offer Effect power | ✓ Good — Smooth migration path |
| Independent versioning | Separate package evolution | ✓ Good — Flexible releases |
| Monorepo with Changesets | Version management and changelogs | ✓ Good — Automated publishing |
| OpenTUI for TUI framework | User preference; TypeScript-native terminal UI | — Pending |

---
*Last updated: 2026-02-07 after v0.3.1 milestone start*
