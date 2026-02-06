/**
 * Graph Workflow Executor
 *
 * Executes DAG workflows with:
 * - Topological ordering
 * - Branch condition evaluation
 * - Fork/join parallelism
 * - Hook integration
 * - Result aggregation
 * - Agent handoff with unlimited chaining
 */

import { DirectedGraph } from 'graphology';
import { topologicalSort } from 'graphology-dag';
import type {
  GraphWorkflowConfig,
  GraphEdge,
  GraphNode,
  BranchCondition,
  AnyGraphNode,
  ForkNode,
  JoinNode,
} from './graph';
import type { PipelineContext } from './context';
import type { ExecutorOptions } from './executor';
import type { HookManager } from '../hooks/manager';
import type { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import type { HookEvent, StepHookEventData, PipelineHookEventData } from '../hooks/types';
import type { AgentManager } from '../agent/manager';
import { isHandoffSignal, type HandoffSignal } from './handoff-tool';
import { prepareHandoffContext } from './handoff';
import type { AgentResponse } from '../agent/agent';
import { Effect } from 'effect';
import { annotateSpan } from '../observability/otel';
import { getCurrentCorrelationContext, getCurrentSpanIds, getCorrelationContext } from '../observability/context';
import { ObservabilityService } from '../observability/service';

/**
 * Graph execution result
 */
export interface GraphExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Final accumulated context */
  context: PipelineContext;
  /** All node outputs by node ID */
  outputs: Record<string, unknown>;
  /** Node IDs in execution order */
  executedNodes: string[];
  /** Error if execution failed */
  error?: Error;
  /** Hook that requested abort */
  abortedBy?: string;
}

/**
 * Graph executor options (extends ExecutorOptions)
 */
export interface GraphExecutorOptions extends ExecutorOptions {
  agentManager: AgentManager;
  hookManager?: HookManager;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (msg: string) => Promise<any> } | undefined;
    executePipelineV2?: (config: any, input: string, options: any) => Promise<any>;
  };
}

/**
 * Evaluate a branch condition against the pipeline context.
 *
 * @param condition - The condition to evaluate
 * @param context - Pipeline context with accumulated outputs
 * @returns true if condition matches, false otherwise
 */
export function evaluateCondition(condition: BranchCondition, context: PipelineContext): boolean {
  // Extract field value using dot notation (e.g., "stepName.status")
  const parts = condition.field.split('.');
  let value: any = context.outputs;

  for (const part of parts) {
    if (value === null || value === undefined) {
      value = undefined;
      break;
    }
    value = value[part];
  }

  switch (condition.operator) {
    case 'exists':
      return value !== undefined && value !== null;

    case 'equals':
      return value === condition.value;

    case 'notEquals':
      return value !== condition.value;

    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;

    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;

    default:
      return false;
  }
}

/**
 * Select next nodes to execute based on current node's outgoing edges.
 * Implements first-match-wins for conditions.
 *
 * @param currentNode - ID of the current node
 * @param edges - All graph edges
 * @param context - Pipeline context for condition evaluation
 * @returns Array of next node IDs to execute
 */
export function selectNextNodes(
  currentNode: string,
  edges: GraphEdge[],
  context: PipelineContext
): string[] {
  // Find all outgoing edges from current node
  const outgoingEdges = edges.filter(edge => edge.from === currentNode);

  if (outgoingEdges.length === 0) {
    return []; // Terminal node
  }

  // First-match-wins: evaluate conditions in order
  for (const edge of outgoingEdges) {
    if (edge.condition && evaluateCondition(edge.condition, context)) {
      return [edge.to];
    }
  }

  // No condition matched, use default edge
  const defaultEdge = outgoingEdges.find(edge => edge.default);
  if (defaultEdge) {
    return [defaultEdge.to];
  }

  // No condition matched and no default, return all unconditional edges
  const unconditionalEdges = outgoingEdges.filter(edge => !edge.condition && !edge.default);
  return unconditionalEdges.map(edge => edge.to);
}

/**
 * Execute a graph workflow.
 *
 * @param config - Graph workflow configuration
 * @param input - User input message
 * @param options - Executor options
 * @returns Graph execution result
 */
export async function executeGraphWorkflow(
  config: GraphWorkflowConfig,
  input: string,
  options: GraphExecutorOptions
): Promise<GraphExecutionResult> {
  const { agentManager, hookManager, tracer, pipelineManager } = options;

  // Build graphology graph for topological ordering
  const graph = new DirectedGraph();

  // Add all nodes
  for (const node of config.nodes) {
    graph.addNode(node.id, { data: node });
  }

  // Add all edges
  for (const edge of config.edges) {
    if (!graph.hasEdge(edge.from, edge.to)) {
      graph.addDirectedEdge(edge.from, edge.to, { data: edge });
    }
  }

  // Create pipeline context
  const context: PipelineContext = {
    pipelineId: config.id,
    input,
    outputs: {},
    history: [],
    metadata: {},
  };

  const executedNodes: string[] = [];
  const nodeOutputs: Record<string, unknown> = {};

  // Create tracing span
  const graphSpan = tracer?.startSpan(`graph.execute.${config.id}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'graph.id': config.id,
      'graph.nodeCount': config.nodes.length,
      'graph.edgeCount': config.edges.length,
      'input.length': input.length,
    },
  });

  // Annotate graph span with Fred identifiers
  const graphAnnotation = annotateSpan({
    runId: context.metadata.runId as string | undefined,
    conversationId: context.conversationId,
    workflowId: config.id,
  });

  // Run annotation effect (fire and forget - best effort)
  Effect.runPromise(graphAnnotation).catch(() => {
    // Annotation failed, continue execution
  });

  const pipelineData: PipelineHookEventData = {
    pipelineId: config.id,
    input,
    context,
  };

  try {
    // Execute beforePipeline hooks with correlation context
    if (hookManager) {
      const correlationCtx = getCurrentCorrelationContext();
      const spanIds = getCurrentSpanIds();
      const beforeEvent: HookEvent = {
        type: 'beforePipeline',
        data: pipelineData,
        // Populate correlation fields
        runId: context.metadata.runId as string | undefined || correlationCtx?.runId,
        conversationId: context.conversationId || correlationCtx?.conversationId,
        intentId: correlationCtx?.intentId,
        timestamp: new Date().toISOString(),
        traceId: spanIds.traceId || correlationCtx?.traceId,
        spanId: spanIds.spanId || correlationCtx?.spanId,
        parentSpanId: spanIds.parentSpanId || correlationCtx?.parentSpanId,
        pipelineId: config.id,
      };
      const beforeResult = await hookManager.executeHooksAndMerge('beforePipeline', beforeEvent);

      if (beforeResult.metadata) {
        context.metadata = { ...context.metadata, ...beforeResult.metadata };
      }

      if ((beforeResult as any).abort) {
        graphSpan?.setStatus('ok');
        graphSpan?.end();
        return {
          success: false,
          context,
          outputs: nodeOutputs,
          executedNodes,
          abortedBy: 'beforePipeline hook',
        };
      }
    }

    // Fire config-specific beforePipeline hooks
    if (config.hooks?.beforePipeline) {
      for (const handler of config.hooks.beforePipeline) {
        const result = await handler({ type: 'beforePipeline', data: pipelineData });
        if ((result as any)?.abort) {
          graphSpan?.setStatus('ok');
          graphSpan?.end();
          return {
            success: false,
            context,
            outputs: nodeOutputs,
            executedNodes,
            abortedBy: 'graph beforePipeline hook',
          };
        }
      }
    }

    // Track which nodes are reachable (active) from entry point
    const activeNodes = new Set<string>();
    const readyQueue: string[] = [config.entryNode];
    activeNodes.add(config.entryNode);

    // Track fork/join state
    const joinNodeSources = new Map<string, Set<string>>(); // joinId -> completed source IDs
    const pendingJoins = new Map<string, JoinNode>(); // joinId -> JoinNode config

    // Initialize join tracking
    for (const node of config.nodes) {
      if (node.type === 'join') {
        joinNodeSources.set(node.id, new Set());
        pendingJoins.set(node.id, node);
      }
    }

    // Execute nodes from ready queue
    while (readyQueue.length > 0) {
      const nodeId = readyQueue.shift()!;
      const node = config.nodes.find(n => n.id === nodeId);

      if (!node) {
        throw new Error(`Node "${nodeId}" not found in graph`);
      }

      // Handle fork nodes
      if (node.type === 'fork') {
        const forkNode = node as ForkNode;

        // Add fork event to span with correlation
        const runId = context.metadata.runId as string | undefined;
        graphSpan?.addEvent('graph.fork', {
          'fork.nodeId': nodeId,
          'fork.branches': forkNode.branches.join(','),
          'fork.branchCount': forkNode.branches.length,
          ...(runId ? { 'fred.runId': runId } : {}),
        });

        // Record fork via ObservabilityService (best-effort)
        if (runId) {
          const recordForkEffect = Effect.gen(function* () {
            const service = yield* ObservabilityService;
            const ctx = yield* getCorrelationContext;
            yield* service.logStructured({
              level: 'debug',
              message: 'Graph fork execution',
              metadata: {
                graphId: config.id,
                forkNodeId: nodeId,
                branches: forkNode.branches,
                ...ctx,
              },
            });
          });

          Effect.runPromise(recordForkEffect).catch(() => {
            // Best-effort: ignore failures
          });
        }

        // Execute all branches in parallel
        const branchPromises = forkNode.branches.map(async (branchId) => {
          // Create isolated context for each branch
          const branchContext: PipelineContext = {
            ...context,
            outputs: { ...context.outputs },
            history: [...context.history],
            metadata: { ...context.metadata },
          };

          const branchNode = config.nodes.find(n => n.id === branchId);
          if (!branchNode) {
            throw new Error(`Branch node "${branchId}" not found`);
          }

          if (branchNode.type === 'fork' || branchNode.type === 'join') {
            throw new Error(`Fork branches cannot directly contain fork/join nodes`);
          }

          // Execute branch node
          const branchResult = await executeNode(
            branchNode as GraphNode,
            branchContext,
            options,
            config,
            hookManager
          );

          return { branchId, result: branchResult, context: branchContext };
        });

        const branchResults = await Promise.all(branchPromises);

        // Record branch outputs
        for (const { branchId, result, context: branchCtx } of branchResults) {
          nodeOutputs[branchId] = result;
          context.outputs[branchId] = result;
          executedNodes.push(branchId);
          activeNodes.add(branchId);

          // Mark branch as complete for any downstream join nodes
          for (const [joinId, joinNode] of pendingJoins) {
            if (joinNode.sources.includes(branchId)) {
              joinNodeSources.get(joinId)!.add(branchId);
            }
          }
        }

        executedNodes.push(nodeId);

        // Check if any join nodes are ready
        for (const [joinId, joinNode] of pendingJoins) {
          const completedSources = joinNodeSources.get(joinId)!;
          const allSourcesComplete = joinNode.sources.every(src => completedSources.has(src));

          if (allSourcesComplete && !activeNodes.has(joinId)) {
            readyQueue.push(joinId);
            activeNodes.add(joinId);
          }
        }

        continue;
      }

      // Handle join nodes
      if (node.type === 'join') {
        const joinNode = node as JoinNode;

        // Add join event to span with correlation
        const runId = context.metadata.runId as string | undefined;
        graphSpan?.addEvent('graph.join', {
          'join.nodeId': nodeId,
          'join.sources': joinNode.sources.join(','),
          'join.sourceCount': joinNode.sources.length,
          'join.strategy': joinNode.mergeStrategy,
          ...(runId ? { 'fred.runId': runId } : {}),
        });

        // Record join via ObservabilityService (best-effort)
        if (runId) {
          const recordJoinEffect = Effect.gen(function* () {
            const service = yield* ObservabilityService;
            const ctx = yield* getCorrelationContext;
            yield* service.logStructured({
              level: 'debug',
              message: 'Graph join execution',
              metadata: {
                graphId: config.id,
                joinNodeId: nodeId,
                sources: joinNode.sources,
                strategy: joinNode.mergeStrategy,
                ...ctx,
              },
            });
          });

          Effect.runPromise(recordJoinEffect).catch(() => {
            // Best-effort: ignore failures
          });
        }

        // Merge outputs from source nodes
        const sourceOutputs = joinNode.sources.map(srcId => nodeOutputs[srcId]);

        let mergedOutput: unknown;
        if (joinNode.mergeStrategy === 'shallow-merge') {
          // Shallow merge: last write wins
          mergedOutput = sourceOutputs.reduce((acc, output) => {
            if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
              return { ...(acc as Record<string, unknown>), ...(output as Record<string, unknown>) };
            }
            return output; // Non-object outputs just use last value
          }, {} as Record<string, unknown>);
        } else {
          // Array strategy: collect all outputs
          mergedOutput = sourceOutputs;
        }

        nodeOutputs[nodeId] = mergedOutput;
        context.outputs[nodeId] = mergedOutput;
        executedNodes.push(nodeId);

        // Select next nodes
        const nextNodes = selectNextNodes(nodeId, config.edges, context);
        for (const nextId of nextNodes) {
          if (!activeNodes.has(nextId)) {
            readyQueue.push(nextId);
            activeNodes.add(nextId);
          }
        }

        continue;
      }

      // Execute regular node (agent, function, conditional, pipeline)
      const runId = context.metadata.runId as string | undefined;
      const nodeSpan = tracer?.startSpan(`graph.node.${nodeId}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
          'node.id': nodeId,
          'node.type': node.type,
          'graph.id': config.id,
          // Add correlation attributes
          ...(runId ? { 'fred.runId': runId } : {}),
          ...(context.conversationId ? { 'fred.conversationId': context.conversationId } : {}),
        },
      });

      // Annotate node span with Fred identifiers
      const nodeAnnotation = annotateSpan({
        runId: context.metadata.runId as string | undefined,
        conversationId: context.conversationId,
        workflowId: config.id,
        stepName: nodeId,
      });

      Effect.runPromise(nodeAnnotation).catch(() => {});

      try {
        const result = await executeNode(
          node as GraphNode,
          context,
          options,
          config,
          hookManager
        );

        nodeOutputs[nodeId] = result;
        context.outputs[nodeId] = result;
        executedNodes.push(nodeId);

        nodeSpan?.setStatus('ok');
        nodeSpan?.end();

        // Select next nodes based on edges and conditions
        const nextNodes = selectNextNodes(nodeId, config.edges, context);

        // Add branch decision event if conditional edges exist
        const outgoingEdges = config.edges.filter(e => e.from === nodeId);
        if (outgoingEdges.some(e => e.condition)) {
          // Record taken branches
          for (const next of nextNodes) {
            const edge = outgoingEdges.find(e => e.to === next);
            graphSpan?.addEvent('graph.branch_taken', {
              'branch.sourceNode': nodeId,
              'branch.targetNode': next,
              'branch.condition': edge?.condition ? JSON.stringify(edge.condition) : 'default',
              'branch.taken': true,
            });

            nodeSpan?.addEvent('graph.branch_taken', {
              'branch.targetNode': next,
              'branch.taken': true,
            });
          }

          // Record not-taken branches
          const notTakenEdges = outgoingEdges.filter(e => !nextNodes.includes(e.to));
          for (const edge of notTakenEdges) {
            graphSpan?.addEvent('graph.branch_not_taken', {
              'branch.sourceNode': nodeId,
              'branch.targetNode': edge.to,
              'branch.condition': edge.condition ? JSON.stringify(edge.condition) : 'default',
              'branch.taken': false,
            });

            nodeSpan?.addEvent('graph.branch_not_taken', {
              'branch.targetNode': edge.to,
              'branch.taken': false,
            });
          }

          // Record branch via ObservabilityService (best-effort)
          const runId = context.metadata.runId as string | undefined;
          if (runId) {
            const recordBranchEffect = Effect.gen(function* () {
              const service = yield* ObservabilityService;
              const ctx = yield* getCorrelationContext;
              yield* service.logStructured({
                level: 'debug',
                message: 'Graph branch decision',
                metadata: {
                  graphId: config.id,
                  nodeId,
                  takenNodes: nextNodes,
                  notTakenNodes: notTakenEdges.map(e => e.to),
                  ...ctx,
                },
              });
            });

            Effect.runPromise(recordBranchEffect).catch(() => {
              // Best-effort: ignore failures
            });
          }
        }

        for (const nextId of nextNodes) {
          if (!activeNodes.has(nextId)) {
            readyQueue.push(nextId);
            activeNodes.add(nextId);
          }
        }

        // Mark this node as complete for any downstream join nodes
        for (const [joinId, joinNode] of pendingJoins) {
          if (joinNode.sources.includes(nodeId)) {
            joinNodeSources.get(joinId)!.add(nodeId);

            // Check if join is now ready
            const completedSources = joinNodeSources.get(joinId)!;
            const allSourcesComplete = joinNode.sources.every(src => completedSources.has(src));

            if (allSourcesComplete && !activeNodes.has(joinId)) {
              readyQueue.push(joinId);
              activeNodes.add(joinId);
            }
          }
        }
      } catch (error) {
        nodeSpan?.setStatus('error', error instanceof Error ? error.message : String(error));
        nodeSpan?.end();
        throw error;
      }
    }

    // Execute afterPipeline hooks with correlation context
    if (hookManager) {
      const afterData = { ...pipelineData, context };
      const afterCorrelationCtx = getCurrentCorrelationContext();
      const afterSpanIds = getCurrentSpanIds();
      const afterEvent: HookEvent = {
        type: 'afterPipeline',
        data: afterData,
        // Populate correlation fields
        runId: context.metadata.runId as string | undefined || afterCorrelationCtx?.runId,
        conversationId: context.conversationId || afterCorrelationCtx?.conversationId,
        intentId: afterCorrelationCtx?.intentId,
        timestamp: new Date().toISOString(),
        traceId: afterSpanIds.traceId || afterCorrelationCtx?.traceId,
        spanId: afterSpanIds.spanId || afterCorrelationCtx?.spanId,
        parentSpanId: afterSpanIds.parentSpanId || afterCorrelationCtx?.parentSpanId,
        pipelineId: config.id,
      };
      await hookManager.executeHooksAndMerge('afterPipeline', afterEvent);
    }

    // Fire config-specific afterPipeline hooks
    if (config.hooks?.afterPipeline) {
      for (const handler of config.hooks.afterPipeline) {
        await handler({
          type: 'afterPipeline',
          data: { ...pipelineData, context },
        });
      }
    }

    graphSpan?.setStatus('ok');
    graphSpan?.end();

    return {
      success: true,
      context,
      outputs: nodeOutputs,
      executedNodes,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Fire onPipelineError hooks
    if (hookManager) {
      const errorEvent: HookEvent = {
        type: 'onPipelineError',
        data: { ...pipelineData, error: err },
      };
      await hookManager.executeHooks('onPipelineError', errorEvent);
    }

    graphSpan?.setStatus('error', err.message);
    graphSpan?.end();

    return {
      success: false,
      context,
      outputs: nodeOutputs,
      executedNodes,
      error: err,
    };
  }
}

/**
 * Execute a single graph node.
 * Helper function that delegates to appropriate executor based on node type.
 */
async function executeNode(
  node: GraphNode,
  context: PipelineContext,
  options: GraphExecutorOptions,
  config: GraphWorkflowConfig,
  hookManager?: HookManager
): Promise<unknown> {
  const { agentManager, pipelineManager, tracer } = options;

  // Create step event data for hooks
  const stepData: StepHookEventData = {
    pipelineId: config.id,
    input: context.input,
    context,
    step: {
      name: node.name || node.id,
      type: node.type,
      index: 0, // Not meaningful in graph context
    },
  };

  // Execute beforeStep hooks with correlation context
  if (hookManager) {
    const correlationCtx = getCurrentCorrelationContext();
    const spanIds = getCurrentSpanIds();
    const beforeEvent: HookEvent = {
      type: 'beforeStep',
      data: stepData,
      // Populate correlation fields
      runId: context.metadata.runId as string | undefined || correlationCtx?.runId,
      conversationId: context.conversationId || correlationCtx?.conversationId,
      intentId: correlationCtx?.intentId,
      agentId: (node.type === 'agent' ? node.agentId : undefined) || correlationCtx?.agentId,
      timestamp: new Date().toISOString(),
      traceId: spanIds.traceId || correlationCtx?.traceId,
      spanId: spanIds.spanId || correlationCtx?.spanId,
      parentSpanId: spanIds.parentSpanId || correlationCtx?.parentSpanId,
      pipelineId: config.id,
      stepName: node.name || node.id,
    };
    const beforeResult = await hookManager.executeHooksAndMerge('beforeStep', beforeEvent);

    if (beforeResult.metadata) {
      context.metadata = { ...context.metadata, ...beforeResult.metadata };
    }

    if (beforeResult.skip) {
      return undefined;
    }

    if ((beforeResult as any).abort) {
      throw new Error('Execution aborted by beforeStep hook');
    }
  }

  // Fire config-specific beforeStep hooks
  if (config.hooks?.beforeStep) {
    for (const handler of config.hooks.beforeStep) {
      const hookResult = await handler({ type: 'beforeStep', data: stepData });
      if (hookResult?.skip) {
        return undefined;
      }
      if (hookResult && 'abort' in hookResult && (hookResult as any).abort) {
        throw new Error('Execution aborted by graph beforeStep hook');
      }
    }
  }

  // Execute node based on type
  let result: unknown;

  switch (node.type) {
    case 'agent': {
      const agent = agentManager.getAgent(node.agentId);
      if (!agent) {
        throw new Error(`Agent "${node.agentId}" not found`);
      }
      const agentResult = await agent.processMessage(context.input, context.history);

      // Check if agent returned a handoff request
      if (isHandoffSignal(agentResult)) {
        result = await handleHandoff(
          agentResult,
          node.agentId,
          context,
          config,
          options,
          hookManager
        );
      } else {
        result = agentResult;
      }
      break;
    }

    case 'function': {
      result = await node.fn(context);
      break;
    }

    case 'conditional': {
      const conditionResult = await node.condition(context);
      result = { conditionResult };
      break;
    }

    case 'pipeline': {
      if (!pipelineManager) {
        throw new Error('Pipeline manager required for pipeline nodes');
      }
      const nestedPipeline = pipelineManager.getPipeline(node.pipelineId);
      if (!nestedPipeline) {
        throw new Error(`Nested pipeline "${node.pipelineId}" not found`);
      }
      result = await nestedPipeline.execute(context.input);
      break;
    }

    default:
      throw new Error(`Unknown node type: ${(node as any).type}`);
  }

  // Record node execution via ObservabilityService (best-effort)
  const runId = context.metadata.runId as string | undefined;
  if (runId) {
    const recordNodeEffect = Effect.gen(function* () {
      const service = yield* ObservabilityService;
      const ctx = yield* getCorrelationContext;
      yield* service.recordRunStepSpan(runId, {
        stepName: node.name || node.id,
        startTime: Date.now(), // Approximate - actual start was earlier
        endTime: Date.now(),
        status: 'success',
        metadata: {
          graphId: config.id,
          nodeType: node.type,
          nodeId: node.id,
          ...ctx,
        },
      });
    });

    Effect.runPromise(recordNodeEffect).catch(() => {
      // Best-effort: ignore failures
    });
  }

  // Execute afterStep hooks with correlation context
  if (hookManager) {
    const afterData: StepHookEventData = { ...stepData, result };
    const afterCorrelationCtx = getCurrentCorrelationContext();
    const afterSpanIds = getCurrentSpanIds();
    const afterEvent: HookEvent = {
      type: 'afterStep',
      data: afterData,
      // Populate correlation fields
      runId: context.metadata.runId as string | undefined || afterCorrelationCtx?.runId,
      conversationId: context.conversationId || afterCorrelationCtx?.conversationId,
      intentId: afterCorrelationCtx?.intentId,
      agentId: (node.type === 'agent' ? node.agentId : undefined) || afterCorrelationCtx?.agentId,
      timestamp: new Date().toISOString(),
      traceId: afterSpanIds.traceId || afterCorrelationCtx?.traceId,
      spanId: afterSpanIds.spanId || afterCorrelationCtx?.spanId,
      parentSpanId: afterSpanIds.parentSpanId || afterCorrelationCtx?.parentSpanId,
      pipelineId: config.id,
      stepName: node.name || node.id,
    };
    const afterResult = await hookManager.executeHooksAndMerge('afterStep', afterEvent);

    if (afterResult.metadata) {
      context.metadata = { ...context.metadata, ...afterResult.metadata };
    }

    if ((afterResult as any).abort) {
      throw new Error('Execution aborted by afterStep hook');
    }
  }

  // Fire config-specific afterStep hooks
  if (config.hooks?.afterStep) {
    for (const handler of config.hooks.afterStep) {
      const handlerResult = await handler({
        type: 'afterStep',
        data: { ...stepData, result },
      });
      if ((handlerResult as any)?.abort) {
        throw new Error('Execution aborted by graph afterStep hook');
      }
    }
  }

  return result;
}

/**
 * Handle agent handoff request.
 *
 * Executes target agent with full context transfer and supports chaining.
 * Handoffs are terminating - source agent does not resume.
 *
 * @param handoffRequest - The handoff request from source agent
 * @param sourceAgentId - ID of the agent initiating handoff
 * @param context - Current pipeline context
 * @param config - Graph workflow configuration
 * @param options - Executor options
 * @param hookManager - Optional hook manager
 * @returns Result from target agent (or handoff chain)
 */
async function handleHandoff(
  handoffRequest: HandoffSignal,
  sourceAgentId: string,
  context: PipelineContext,
  config: GraphWorkflowConfig,
  options: GraphExecutorOptions,
  hookManager?: HookManager
): Promise<unknown> {
  const { agentManager, tracer } = options;
  const { targetAgent, reason } = handoffRequest;

  // Validate against workflow handoff config
  if (!config.handoffs?.[sourceAgentId]?.includes(targetAgent)) {
    // Invalid handoff target - return error to source agent
    const availableTargets = config.handoffs?.[sourceAgentId] || [];
    const error = `Handoff to '${targetAgent}' not allowed. Available: ${availableTargets.join(', ')}`;

    return {
      type: 'handoff_error',
      error,
      availableTargets,
    };
  }

  // Prepare handoff context with full thread history
  const handoffContext = prepareHandoffContext(
    { targetAgent, reason },
    context,
    {
      sourceAgent: sourceAgentId,
      allowedTargets: config.handoffs[sourceAgentId],
    }
  );

  // Fire afterStep hook with handoff metadata
  if (hookManager) {
    const handoffStepData: StepHookEventData = {
      pipelineId: config.id,
      input: context.input,
      context,
      step: {
        name: `handoff-${sourceAgentId}-to-${targetAgent}`,
        type: 'agent',
        index: 0,
      },
      result: {
        type: 'handoff',
        handoffFrom: sourceAgentId,
        handoffTo: targetAgent,
        handoffReason: reason,
      },
    };

    const afterEvent: HookEvent = {
      type: 'afterStep',
      data: handoffStepData,
    };

    await hookManager.executeHooksAndMerge('afterStep', afterEvent);
  }

  // Update context with handoff context (includes history transfer)
  context.history = handoffContext.history;
  context.outputs = { ...context.outputs, ...handoffContext.outputs };

  // Update context metadata with handoff chain
  // Add source agent to chain (target will be added if it also hands off)
  const handoffChain = (context.metadata.handoffChain as string[] | undefined) || [];
  const updatedChain = [...handoffChain, sourceAgentId];

  context.metadata = {
    ...context.metadata,
    ...handoffContext.metadata,
    handoffFrom: sourceAgentId,
    handoffTo: targetAgent,
    handoffReason: reason,
    handoffChain: updatedChain,
  };

  // Create span for handoff execution
  const handoffSpan = tracer?.startSpan(`graph.handoff.${sourceAgentId}-to-${targetAgent}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'handoff.from': sourceAgentId,
      'handoff.to': targetAgent,
      'handoff.reason': reason || '',
      'handoff.chainDepth': handoffChain.length,
    },
  });

  try {
    // Execute target agent with transferred context
    const targetAgentInstance = agentManager.getAgent(targetAgent);
    if (!targetAgentInstance) {
      throw new Error(`Target agent "${targetAgent}" not found for handoff`);
    }

    const targetResult = await targetAgentInstance.processMessage(
      context.input,
      context.history
    );

    // Check if target agent also requested a handoff (chaining)
    if (isHandoffSignal(targetResult)) {
      handoffSpan?.setAttributes({
        'handoff.chained': true,
        'handoff.nextTarget': targetResult.targetAgent,
      });
      handoffSpan?.end();

      // Recursive handoff - no depth limit
      return await handleHandoff(
        targetResult,
        targetAgent,
        context,
        config,
        options,
        hookManager
      );
    }

    handoffSpan?.setStatus('ok');
    handoffSpan?.end();

    // Target agent completed successfully
    return targetResult;
  } catch (error) {
    if (handoffSpan && error instanceof Error) {
      handoffSpan.recordException(error);
      handoffSpan.setStatus('error', error.message);
    }
    handoffSpan?.end();
    throw error;
  }
}
