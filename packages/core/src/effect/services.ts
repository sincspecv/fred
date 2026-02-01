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
} from '../tool/service';

export {
  HookManagerService,
  HookManagerServiceLive,
} from '../hooks/service';

export {
  ProviderRegistryService,
  ProviderRegistryServiceLive,
} from '../platform/service';

export {
  ContextStorageService,
  ContextStorageServiceLive,
} from '../context/service';

export {
  AgentService,
  AgentServiceLive,
} from '../agent/service';

export {
  CheckpointService,
} from '../pipeline/checkpoint/service';

export {
  PauseService,
  PauseServiceLive,
} from '../pipeline/pause/service';

export {
  PipelineService,
  PipelineServiceLive,
} from '../pipeline/service';

// Aggregate exports
export {
  FredLayers,
  createFredRuntime,
  createScopedFredRuntime,
} from '../services';

// Type exports
export type {
  FredRuntime,
  FredServices,
} from '../services';
