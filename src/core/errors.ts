/**
 * Aggregate exports for all tagged errors across service domains.
 *
 * This barrel file enables:
 * - Individual domain imports: `import { AgentNotFoundError } from 'fred/effect'`
 * - Union type imports: `import { FredError } from 'fred/effect'`
 * - Effect catchTag pattern: `Effect.catchTag("AgentNotFoundError", (e) => ...)`
 */

// Agent errors
export * from './agent/errors';

// Pipeline errors
export * from './pipeline/errors';

// Context errors
export * from './context/errors';

// Tool errors
export * from './tool/errors';

// Platform/Provider errors
export * from './platform/errors';

// Hook errors
export * from './hooks/errors';

// Combined FredError union for top-level catching
import type { AgentError } from './agent/errors';
import type { PipelineError } from './pipeline/errors';
import type { ContextError } from './context/errors';
import type { ToolError } from './tool/errors';
import type { ProviderError } from './platform/errors';
import type { HookError } from './hooks/errors';

/**
 * Union of all Fred service errors, enabling exhaustive error handling.
 *
 * Use this type when you need to handle errors across all service domains:
 * ```typescript
 * Effect.catchAll((error: FredError) => {
 *   if (error._tag === 'AgentNotFoundError') { ... }
 *   else if (error._tag === 'PipelineExecutionError') { ... }
 * })
 * ```
 */
export type FredError =
  | AgentError
  | PipelineError
  | ContextError
  | ToolError
  | ProviderError
  | HookError;
