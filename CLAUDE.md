# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fred is a TypeScript framework for building AI agents with intent-based routing, multi-platform support, and pipeline orchestration. Built on Bun runtime using the Effect library for functional programming patterns and @effect/ai for AI provider integration.

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

## Architecture

### Core Concepts

- **Fred**: Main orchestrator class (`src/index.ts`) - manages agents, pipelines, routing, and context
- **Agents**: AI-powered entities with system prompts and tools (`src/core/agent/`)
- **Pipelines**: Sequential/graph-based agent orchestration with checkpointing (`src/core/pipeline/`)
- **Intents**: Message routing based on exact/regex/semantic matching (`src/core/intent/`)
- **Tools**: Reusable functions agents can call (`src/core/tool/`)
- **Providers**: AI platform integrations via Effect provider packs (`src/core/platform/`)

### Key Patterns

**Effect-based AI Providers**: All AI operations use Effect for error handling and dependency injection:
```typescript
// Providers return Effect-wrapped models
const modelEffect = provider.getModel(config.model, { temperature: 0.7 });
const model = await Effect.runPromise(modelEffect);
```

**Message Normalization**: Messages use `@effect/ai` Prompt encoding (`Prompt.MessageEncoded`). Normalize via `src/core/messages.ts`:
```typescript
import { normalizeMessage, normalizeMessages } from './core/messages';
```

**Provider Registry**: Providers register via packs in `src/core/platform/packs/`. Each pack exports an `EffectProviderFactory`:
```typescript
// Built-in packs: openai, anthropic, google, groq, openrouter
import { BUILTIN_PACKS } from './core/platform/packs';
```

**Pipeline Context**: Pipelines share state through `PipelineContext` with checkpoint support for pause/resume.

### Directory Structure

```
src/
├── core/
│   ├── agent/        # Agent creation and management
│   ├── context/      # Conversation history storage (sqlite/postgres)
│   ├── pipeline/     # Pipeline execution, checkpoints, graph workflows
│   ├── platform/     # AI provider registry and packs
│   ├── intent/       # Intent matching and routing
│   ├── tool/         # Tool registry and validation
│   ├── routing/      # Rule-based message routing
│   ├── workflow/     # Multi-workflow management
│   ├── hooks/        # Pipeline lifecycle hooks
│   ├── mcp/          # Model Context Protocol client
│   ├── tracing/      # OpenTelemetry integration
│   └── stream/       # Streaming event types
├── config/           # YAML/JSON config loading
├── server/           # HTTP server and chat API
└── utils/            # Validation, prompt loading
```

## Development Guidelines

### Adding a New AI Provider

1. Create pack in `src/core/platform/packs/yourprovider.ts`
2. Export `EffectProviderFactory` with `id`, `aliases`, `createDefinition`
3. Register in `src/core/platform/packs/index.ts`

### Testing

- Tests mirror `src/` structure in `tests/unit/`
- Use mocks from `tests/unit/helpers/` for agents, providers, storage
- Only test deterministic behavior - mock AI calls

### Config Files

Fred supports YAML/JSON config (`loadConfig` from `src/config/loader.ts`):
- Agents, intents, pipelines, tools, routing rules
- Provider declarations with model defaults
- Persistence (sqlite/postgres) and observability settings

### Environment Variables

Key provider API keys (auto-detected in dev-chat):
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
- `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`
- `FRED_POSTGRES_URL` or `FRED_SQLITE_PATH` for persistence
