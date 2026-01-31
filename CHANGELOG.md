# Changelog

All notable changes to Fred will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] - 2026-01-30

### Added

- **Effect Services Architecture**: All internal managers converted to Effect Services with proper Layers
  - `ToolRegistryService` - Tool management with Effect
  - `HookManagerService` - Hook execution with Effect
  - `ProviderRegistryService` - Provider management with Effect
  - `ContextStorageService` - Conversation storage with Effect
  - `AgentService` - Agent lifecycle with Effect
  - `CheckpointService` - Checkpoint persistence with Effect
  - `PauseService` - Pause/resume with Effect
  - `PipelineService` - Pipeline orchestration with Effect

- **Effect API (`fred/effect`)**: Optional import path for power users
  - Export all Services and Live Layers
  - Export all tagged errors
  - Export `FredLayers` aggregate layer
  - Export `FredService` for convenient access
  - Export `createFredRuntime` for custom runtime creation
  - Export `withCustomLayer` for layer replacement
  - Re-export `Effect`, `Layer`, `Context` for convenience

- **Tagged Errors**: Type-safe error handling with Effect's `Data.TaggedError`
  - Agent errors: `AgentNotFoundError`, `AgentAlreadyExistsError`, `AgentCreationError`, `AgentExecutionError`
  - Pipeline errors: `PipelineNotFoundError`, `PipelineAlreadyExistsError`, `PipelineExecutionError`, `PipelineStepError`
  - Checkpoint errors: `CheckpointNotFoundError`, `CheckpointExpiredError`
  - Pause errors: `PauseNotFoundError`, `PauseExpiredError`
  - Tool errors: `ToolNotFoundError`, `ToolAlreadyExistsError`, `ToolValidationError`, `ToolExecutionError`
  - Context errors: `ContextNotFoundError`, `ContextStorageError`
  - Provider errors: `ProviderNotFoundError`, `ProviderRegistrationError`, `ProviderModelError`
  - Other errors: `GraphValidationError`, `ConcurrencyError`, `HookExecutionError`
  - Union types: `AgentError`, `PipelineError`, `ToolError`, `ContextError`, `ProviderError`, `HookError`, `FredError`

- **StreamResult**: Vercel AI SDK-style streaming result object
  - `textStream` AsyncIterable for text-only streaming
  - `fullStream` AsyncIterable for all events
  - `text`, `usage`, `steps` Promise accessors
  - `onChunk`, `onFinish`, `onError` callbacks
  - Replay capability after first stream consumption

- **Fred.create()**: Async factory for proper Effect runtime initialization

- **Fred.shutdown()**: Graceful shutdown with resource cleanup

- **Fred.getRuntime()**: Access Effect runtime for power users

### Changed

- `streamMessage()` now returns `StreamResult` instead of raw `AsyncIterable<StreamEvent>`
  - Use `result.fullStream` for equivalent behavior to v0.1.x
  - Use `result.textStream` for text-only streaming
  - Use `await result.text` for final aggregated text

- Error objects now include `cause` property with the original Effect tagged error
  - Enables type-safe error discrimination via `error.cause._tag`

- Internal architecture uses Effect Services for concurrency-safe operations
  - Promise API maintained for backwards compatibility
  - Effect API available via `fred/effect` for power users

### Deprecated

- Direct `new Fred()` construction for long-running applications
  - Use `Fred.create()` for eager runtime initialization
  - Constructor still works but may emit deprecation warning in development

### Migration

See [Migration Guide](docs/migration/v0.2.5.md) for detailed before/after examples.

## [0.2.4] - Previous Release

- OpenTelemetry-compatible observability
- Groq and OpenRouter provider packs
- Effect runMain entry points

## [0.2.0] - Earlier Release

- Multi-step pipeline streaming
- Graph workflow execution
- Checkpoint/pause system

## [0.1.0] - Initial Release

- Core agent framework
- Intent-based routing
- Pipeline orchestration
- Tool management
- Provider integration
