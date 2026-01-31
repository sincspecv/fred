/**
 * Layer Composition Utilities
 *
 * For users who want to provide custom service implementations:
 * ```typescript
 * import { FredLayers, AgentService, AgentServiceLive } from 'fred/effect';
 * import { Layer } from 'effect';
 *
 * // Replace AgentService with custom implementation
 * const customAgentLayer = Layer.succeed(AgentService, myCustomAgentImpl);
 *
 * const customLayers = FredLayers.pipe(
 *   Layer.provideMerge(customAgentLayer)
 * );
 * ```
 */

import { Effect, Layer, Context } from 'effect';
import { FredLayers, type FredServices } from '../core/services';
import { AgentService } from '../core/agent/service';
import { PipelineService } from '../core/pipeline/service';
import { ContextStorageService } from '../core/context/service';

// Re-export main layers
export { FredLayers } from '../core/services';

/**
 * Create FredLayers with a custom service layer merged in.
 *
 * @param customLayer - Layer providing a custom service implementation
 * @returns FredLayers with custom service merged
 */
export const withCustomLayer = <T>(
  customLayer: Layer.Layer<T, never, never>
): Layer.Layer<FredServices | T> => {
  return Layer.merge(FredLayers, customLayer);
};

/**
 * FredService - Aggregate service for convenient access
 *
 * Power users can use this instead of accessing individual services:
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const fred = yield* FredService;
 *   const agent = yield* fred.agents.getAgent(id);
 *   const pipeline = yield* fred.pipelines.getPipeline(pipelineId);
 * });
 * ```
 */
export interface FredService {
  readonly agents: Context.Tag.Service<typeof AgentService>;
  readonly pipelines: Context.Tag.Service<typeof PipelineService>;
  readonly context: Context.Tag.Service<typeof ContextStorageService>;
}

export const FredService = Context.GenericTag<FredService>('FredService');

/**
 * Live layer for FredService
 */
export const FredServiceLive = Layer.effect(
  FredService,
  Effect.gen(function* () {
    return {
      agents: yield* AgentService,
      pipelines: yield* PipelineService,
      context: yield* ContextStorageService,
    };
  })
).pipe(Layer.provide(FredLayers));
