/**
 * Fred Effect API
 *
 * This module exposes the full Effect-based API for power users
 * who want Effect composition instead of the Promise facade.
 *
 * @example Basic usage
 * ```typescript
 * import { FredLayers, AgentService } from 'fred/effect';
 * import { Effect } from 'effect';
 *
 * const program = Effect.gen(function* () {
 *   const agentService = yield* AgentService;
 *   const agents = yield* agentService.getAllAgents();
 *   return agents;
 * });
 *
 * const result = await Effect.runPromise(
 *   program.pipe(Effect.provide(FredLayers))
 * );
 * ```
 *
 * @example Custom layers
 * ```typescript
 * import { FredLayers, AgentService, withCustomLayer } from 'fred/effect';
 * import { Layer } from 'effect';
 *
 * const myAgentLayer = Layer.succeed(AgentService, myCustomImpl);
 * const customLayers = withCustomLayer(myAgentLayer);
 * ```
 *
 * @example Error handling
 * ```typescript
 * import { AgentNotFoundError } from 'fred/effect';
 *
 * program.pipe(
 *   Effect.catchTag("AgentNotFoundError", (e) =>
 *     Effect.succeed(fallbackAgent)
 *   )
 * );
 * ```
 *
 * @packageDocumentation
 */

// Services
export * from './services';

// Errors
export * from './errors';

// Layers and composition
export * from './layers';

// Re-export Effect for convenience
// Users often need these alongside Fred services
export { Effect, Layer, Context, Ref, Fiber, Scope, Stream } from 'effect';
