# AGENTS.md

This repository uses specialized skills. When working here, always prefer using a relevant skill before ad-hoc implementation.

## Project Overview

Fred is a TypeScript framework for building AI agents with intent-based routing, multi-platform support, and pipeline orchestration. Built on Bun runtime using the Effect library for functional programming patterns and @effect/ai for AI provider integration.

This is a monorepo using Bun workspaces with packages in the `packages/` directory.

## Build & Test Commands

```bash
# Install dependencies
bun install

# Run development chat interface
bun run dev

# Run tests
bun test                              # All tests
bun test:unit                         # Unit tests only
bun test tests/unit/core/tool         # Tests matching pattern
bun test tests/unit/core/tool/registry.test.ts  # Single file

# Build
bun run build

# Run server
bun run server

# Documentation
bun run docs:dev   # Local server at localhost:8000
bun run docs:build
```

## Monorepo Structure

```
packages/
├── core/               # Core framework (@fred/core)
│   └── src/
│       ├── agent/          # Agent creation and management
│       ├── config/         # YAML/JSON config loading
│       ├── context/        # Conversation history storage (sqlite/postgres)
│       ├── effect/         # Effect services and layers
│       ├── eval/           # Evaluation and testing framework
│       ├── hooks/          # Pipeline lifecycle hooks
│       ├── intent/         # Intent matching and routing
│       ├── mcp/            # Model Context Protocol client
│       ├── message-processor/  # Message processing pipeline
│       ├── observability/  # Metrics and monitoring
│       ├── pipeline/       # Pipeline execution, checkpoints, graph workflows
│       ├── platform/       # AI provider registry and packs
│       ├── provider/       # Provider service
│       ├── routing/        # Rule-based message routing
│       ├── stream/         # Streaming event types
│       ├── tool/           # Tool registry and validation
│       ├── tool-gate/      # Tool execution gating
│       ├── tracing/        # OpenTelemetry integration
│       ├── utils/          # Validation, utilities
│       ├── variables/      # Variable substitution and tools
│       └── workflow/       # Multi-workflow management
├── cli/                # CLI and TUI (@fred/cli)
├── dev/                # Development server and chat UI
├── provider-openai/    # OpenAI provider
├── provider-anthropic/ # Anthropic provider
├── provider-google/    # Google provider
├── provider-groq/      # Groq provider
└── provider-openrouter/ # OpenRouter provider
```

## Core Architecture

### Core Concepts

- **Fred**: Main orchestrator class (`packages/core/src/index.ts`) - manages agents, pipelines, routing, and context
- **Agents**: AI-powered entities with system prompts and tools (`packages/core/src/agent/`)
- **Pipelines**: Sequential/graph-based agent orchestration with checkpointing (`packages/core/src/pipeline/`)
- **Intents**: Message routing based on exact/regex/semantic matching (`packages/core/src/intent/`)
- **Tools**: Reusable functions agents can call (`packages/core/src/tool/`). Includes built-in tools (calculator) and support for custom tools
- **Built-in Tools**: Production-ready tools available out-of-the-box:
  - Calculator tool (`createCalculatorTool()` from `packages/core/src/tool/calculator.ts`) - Safe arithmetic evaluation
- **Providers**: AI platform integrations via Effect provider packs (`packages/core/src/platform/`)

### Key Patterns

**Effect-based AI Providers**: All AI operations use Effect for error handling and dependency injection:
```typescript
// Providers return Effect-wrapped models
const modelEffect = provider.getModel(config.model, { temperature: 0.7 });
const model = await Effect.runPromise(modelEffect);
```

**Message Normalization**: Messages use `@effect/ai` Prompt encoding (`Prompt.MessageEncoded`). Normalize via `packages/core/src/messages.ts`:
```typescript
import { normalizeMessage, normalizeMessages } from '@fred/core/messages';
```

**Provider Registry**: Providers register via packs in `packages/core/src/platform/packs/`. Each pack exports an `EffectProviderFactory`:
```typescript
// Built-in packs: openai, anthropic, google, groq, openrouter
import { BUILTIN_PACKS } from '@fred/core/platform/packs';
```

**Pipeline Context**: Pipelines share state through `PipelineContext` with checkpoint support for pause/resume.

**Tool Schema Formats**: Tools support two schema formats:
- **Effect Schema format (recommended)**: Uses `schema` property with Effect Schema definitions for better type safety
- **Legacy parameters format**: Uses `parameters` property with JSON Schema
```typescript
// Effect Schema format (used by built-in tools)
import { Schema } from 'effect';
const tool: Tool = {
  schema: {
    input: Schema.Struct({ expression: Schema.String }),
    success: Schema.String,
    metadata: { /* JSON Schema for AI */ }
  },
  // ...
};

// Legacy format (still supported)
const tool: Tool = {
  parameters: {
    type: 'object',
    properties: { /* ... */ }
  },
  // ...
};
```

## Development Guidelines

### Adding a New AI Provider

1. Create pack in `packages/core/src/platform/packs/yourprovider.ts`
2. Export `EffectProviderFactory` with `id`, `aliases`, `createDefinition`
3. Register in `packages/core/src/platform/packs/index.ts`

### Testing

- Tests are in `tests/unit/` and mirror the packages structure
- Use mocks from `tests/unit/helpers/` for agents, providers, storage
- Only test deterministic behavior - mock AI calls
- Package tests can also be co-located in `packages/<name>/tests/`

### Config Files

Fred supports YAML/JSON config (`loadConfig` from `packages/core/src/config/loader.ts`):
- Agents, intents, pipelines, tools, routing rules
- Provider declarations with model defaults
- Persistence (sqlite/postgres) and observability settings

### Environment Variables

Key provider API keys (auto-detected in dev-chat):
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
- `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`
- `FRED_POSTGRES_URL` or `FRED_SQLITE_PATH` for persistence

## Skill Usage Rule

- Before starting work, quickly classify the task (TUI, Effect, docs lookup, architecture, etc.).
- If a matching skill exists, use it first.
- If multiple skills apply, use the most specific one first, then supporting skills.
- Document in your response which skill(s) you used and why.

## Primary Skills For This Project

### `opentui`

Use for terminal UI work in CLI/TUI features, including:
- Layout and pane composition
- Keyboard handling and focus management
- Streaming UI updates and rendering behavior
- TUI component patterns and testing

### `effect-ts`

Use for Effect-based TypeScript implementation, including:
- Services, Layers, and dependency wiring
- Effect runtime usage and structured error handling
- Stream and concurrency primitives
- Correct API usage for current Effect versions

### `effect-best-practices`

Use as a guardrail whenever writing or reviewing Effect code, especially:
- Service/tag design
- Error modeling and typed failures
- Layer composition and modular boundaries
- Avoiding anti-patterns in Effect-based code

## Supporting Skills Also Relevant Here

### `context7`

Use for up-to-date documentation checks when integrating or validating:
- Effect ecosystem packages
- Bun/platform APIs
- TUI libraries and related dependencies

### `prompt-engineering-patterns`

Use when editing system prompts, agent instructions, or routing prompt templates to improve:
- Reliability
- Controllability
- Output consistency

### `architecture-patterns`

Use for larger refactors or new subsystems that benefit from:
- Clean architecture boundaries
- Domain modeling clarity
- Maintainable service decomposition

### `sql-optimization-patterns`

Use when working on persistence/query performance areas (SQLite/Postgres), including:
- Slow query analysis
- Index strategy
- Schema/query optimization

### `resolve-conflicts`

Use immediately when merge conflicts appear. Do not resolve conflicts ad-hoc first.

## Practical Selection Cheatsheet

- TUI or keyboard UX change -> `opentui`
- Effect service/layer/stream change -> `effect-ts` + `effect-best-practices`
- Library/API uncertainty -> `context7`
- Prompt/routing behavior tuning -> `prompt-engineering-patterns`
- Cross-module design/refactor -> `architecture-patterns`
- DB perf issue -> `sql-optimization-patterns`
- Merge conflict work -> `resolve-conflicts`

## Default Workflow Expectation

1. Identify applicable skill(s)
2. Load and apply skill guidance
3. Implement change
4. Validate with tests/typecheck
5. Report what skill(s) were applied
