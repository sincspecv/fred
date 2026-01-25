/**
 * Graph Workflow Builder
 *
 * Fluent API for constructing GraphWorkflowConfig programmatically.
 * Provides methods for adding nodes, edges, fork/join control flow, and handoff configuration.
 */

import type {
  GraphWorkflowConfig,
  GraphNode,
  AgentGraphNode,
  FunctionGraphNode,
  ConditionalGraphNode,
  PipelineGraphNode,
  ForkNode,
  JoinNode,
  AnyGraphNode,
  GraphEdge,
  BranchCondition,
} from './graph';
import type { PipelineHooks } from './pipeline';
import { validateGraphWorkflow } from './graph-validator';

/**
 * Node configuration for addNode method
 */
type NodeConfig =
  | { type: 'agent'; agentId: string; expose?: string[] }
  | { type: 'function'; fn: (ctx: any) => Promise<unknown> | unknown; expose?: string[] }
  | { type: 'conditional'; condition: (ctx: any) => boolean | Promise<boolean>; expose?: string[] }
  | { type: 'pipeline'; pipelineId: string; expose?: string[] };

/**
 * Fluent builder for graph workflows.
 *
 * @example
 * const workflow = new GraphWorkflowBuilder('approval-workflow')
 *   .addNode('review', { type: 'agent', agentId: 'reviewer', expose: ['decision'] })
 *   .addNode('approve', { type: 'agent', agentId: 'approver' })
 *   .addNode('reject', { type: 'function', fn: async (ctx) => ({ rejected: true }) })
 *   .addEdge('review', 'approve', { condition: { field: 'review.decision', operator: 'equals', value: 'approved' } })
 *   .addEdge('review', 'reject', { condition: { field: 'review.decision', operator: 'equals', value: 'rejected' } })
 *   .setDefaultEdge('review', 'approve')
 *   .setEntry('review')
 *   .build();
 */
export class GraphWorkflowBuilder {
  private id: string;
  private nodes: AnyGraphNode[] = [];
  private edges: GraphEdge[] = [];
  private entryNode?: string;
  private handoffs: Record<string, string[]> = {};
  private hooks?: PipelineHooks;
  private nodeIds: Set<string> = new Set();

  constructor(id: string) {
    if (!id || id.trim() === '') {
      throw new Error('Workflow ID is required');
    }
    this.id = id;
  }

  /**
   * Add a node to the graph.
   *
   * @param id - Unique node identifier
   * @param config - Node configuration (type, agent/function/condition, expose fields)
   * @returns this for chaining
   * @throws Error if node ID already exists
   */
  addNode(id: string, config: NodeConfig): this {
    if (this.nodeIds.has(id)) {
      throw new Error(`Node ID "${id}" already exists in graph workflow "${this.id}"`);
    }

    let node: GraphNode;

    switch (config.type) {
      case 'agent':
        node = {
          type: 'agent',
          id,
          agentId: config.agentId,
          expose: config.expose,
        } as AgentGraphNode;
        break;

      case 'function':
        node = {
          type: 'function',
          id,
          fn: config.fn,
          expose: config.expose,
        } as FunctionGraphNode;
        break;

      case 'conditional':
        node = {
          type: 'conditional',
          id,
          condition: config.condition,
          expose: config.expose,
        } as ConditionalGraphNode;
        break;

      case 'pipeline':
        node = {
          type: 'pipeline',
          id,
          pipelineId: config.pipelineId,
          expose: config.expose,
        } as PipelineGraphNode;
        break;
    }

    this.nodes.push(node);
    this.nodeIds.add(id);
    return this;
  }

  /**
   * Add a fork node for explicit parallelism.
   *
   * @param id - Unique fork node identifier
   * @param branches - Array of node IDs to execute in parallel
   * @returns this for chaining
   * @throws Error if node ID already exists
   */
  addForkNode(id: string, branches: string[]): this {
    if (this.nodeIds.has(id)) {
      throw new Error(`Node ID "${id}" already exists in graph workflow "${this.id}"`);
    }

    const forkNode: ForkNode = {
      type: 'fork',
      id,
      branches,
    };

    this.nodes.push(forkNode);
    this.nodeIds.add(id);
    return this;
  }

  /**
   * Add a join node to wait for parallel branches.
   *
   * @param id - Unique join node identifier
   * @param sources - Array of node IDs to wait for
   * @param mergeStrategy - How to merge outputs ('shallow-merge' | 'array'), defaults to 'shallow-merge'
   * @returns this for chaining
   * @throws Error if node ID already exists
   */
  addJoinNode(id: string, sources: string[], mergeStrategy: 'shallow-merge' | 'array' = 'shallow-merge'): this {
    if (this.nodeIds.has(id)) {
      throw new Error(`Node ID "${id}" already exists in graph workflow "${this.id}"`);
    }

    const joinNode: JoinNode = {
      type: 'join',
      id,
      sources,
      mergeStrategy,
    };

    this.nodes.push(joinNode);
    this.nodeIds.add(id);
    return this;
  }

  /**
   * Add an edge connecting two nodes.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @param options - Optional condition and/or default flag
   * @returns this for chaining
   */
  addEdge(from: string, to: string, options?: { condition?: BranchCondition; default?: boolean }): this {
    const edge: GraphEdge = {
      from,
      to,
      condition: options?.condition,
      default: options?.default,
    };

    this.edges.push(edge);
    return this;
  }

  /**
   * Set a default edge from a node.
   * Shorthand for addEdge with default: true.
   *
   * @param from - Source node ID
   * @param to - Target node ID
   * @returns this for chaining
   */
  setDefaultEdge(from: string, to: string): this {
    return this.addEdge(from, to, { default: true });
  }

  /**
   * Configure handoff permissions.
   *
   * @param sourceAgent - Source agent ID
   * @param targets - Array of allowed target agent IDs
   * @returns this for chaining
   */
  allowHandoff(sourceAgent: string, targets: string[]): this {
    this.handoffs[sourceAgent] = targets;
    return this;
  }

  /**
   * Set the entry node where execution begins.
   *
   * @param nodeId - ID of the entry node
   * @returns this for chaining
   */
  setEntry(nodeId: string): this {
    this.entryNode = nodeId;
    return this;
  }

  /**
   * Set lifecycle hooks for the workflow.
   *
   * @param hooks - Pipeline hooks configuration
   * @returns this for chaining
   */
  setHooks(hooks: PipelineHooks): this {
    this.hooks = hooks;
    return this;
  }

  /**
   * Build and validate the graph workflow configuration.
   *
   * @returns Validated GraphWorkflowConfig
   * @throws Error if entry node not set
   * @throws GraphValidationError if validation fails
   */
  build(): GraphWorkflowConfig {
    if (!this.entryNode) {
      throw new Error(`Graph workflow "${this.id}" must have an entry node. Call setEntry(nodeId) before build()`);
    }

    const config: GraphWorkflowConfig = {
      id: this.id,
      type: 'graph',
      nodes: this.nodes,
      edges: this.edges,
      entryNode: this.entryNode,
    };

    if (Object.keys(this.handoffs).length > 0) {
      config.handoffs = this.handoffs;
    }

    if (this.hooks) {
      config.hooks = this.hooks;
    }

    // Validate before returning
    validateGraphWorkflow(config);

    return config;
  }
}
