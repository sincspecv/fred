/**
 * Effect Services for Fred
 *
 * Import individual services for targeted dependency injection:
 * ```typescript
 * import { AgentService, AgentServiceLive } from 'fred/effect';
 *
 * const program = Effect.gen(function* () {
 *   const agents = yield* AgentService;
 *   return yield* agents.getAllAgents();
 * });
 * ```
 */

// Core services
export {
  ToolRegistryService,
  ToolRegistryServiceLive,
} from '../core/tool/service';

export {
  HookManagerService,
  HookManagerServiceLive,
} from '../core/hooks/service';

export {
  ProviderRegistryService,
  ProviderRegistryServiceLive,
} from '../core/platform/service';

export {
  ContextStorageService,
  ContextStorageServiceLive,
} from '../core/context/service';

export {
  AgentService,
  AgentServiceLive,
} from '../core/agent/service';

export {
  CheckpointService,
} from '../core/pipeline/checkpoint/service';

export {
  PauseService,
  PauseServiceLive,
} from '../core/pipeline/pause/service';

export {
  PipelineService,
  PipelineServiceLive,
} from '../core/pipeline/service';

// Aggregate exports
export {
  FredLayers,
  createFredRuntime,
  createScopedFredRuntime,
} from '../core/services';

// Type exports
export type {
  FredRuntime,
  FredServices,
} from '../core/services';
