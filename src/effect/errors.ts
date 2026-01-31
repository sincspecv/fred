/**
 * Tagged Errors for Fred
 *
 * All errors use Data.TaggedError for type-safe error handling:
 * ```typescript
 * import { AgentNotFoundError } from 'fred/effect';
 *
 * const program = Effect.gen(function* () {
 *   const agent = yield* agentService.getAgent(id);
 *   return agent;
 * }).pipe(
 *   Effect.catchTag("AgentNotFoundError", (e) => {
 *     console.log(`Agent ${e.id} not found`);
 *     return Effect.succeed(defaultAgent);
 *   })
 * );
 * ```
 */

// Re-export all errors from core
export * from '../core/errors';

// Also export union types for exhaustive handling
export type {
  AgentError,
  PipelineError,
  ContextError,
  ToolError,
  ProviderError,
  HookError,
  FredError,
} from '../core/errors';
