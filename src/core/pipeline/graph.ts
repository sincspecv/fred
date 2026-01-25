/**
 * Graph Workflow Types
 *
 * Types for DAG-based (directed acyclic graph) workflow execution with branching paths.
 * Supports conditional edges, parallel execution via fork/join, and agent handoffs.
 */

import type { PipelineHooks } from './pipeline';

/**
 * Branch condition for evaluating graph edges
 */
export interface BranchCondition {
  /** Dot-notation path to step output field (e.g., "stepName.status") */
  field: string;
  /** Comparison operator */
  operator: 'equals' | 'notEquals' | 'exists' | 'gt' | 'lt';
  /** Value to compare against (required for equals/notEquals/gt/lt) */
  value?: unknown;
}

/**
 * Edge connecting two nodes in the graph
 */
export interface GraphEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Optional condition evaluated at runtime to determine if edge should be taken */
  condition?: BranchCondition;
  /** Marks this as the default/fallback edge when multiple edges exist from same node */
  default?: boolean;
}

/**
 * Base fields for all graph nodes
 */
interface BaseGraphNode {
  /** Unique node identifier */
  id: string;
  /** Optional display name (defaults to id) */
  name?: string;
  /** Fields from this node's output to expose for condition evaluation */
  expose?: string[];
}

/**
 * Agent node - executes a registered agent
 */
export interface AgentGraphNode extends BaseGraphNode {
  type: 'agent';
  /** ID of the registered agent to execute */
  agentId: string;
}

/**
 * Function node - executes a custom function
 */
export interface FunctionGraphNode extends BaseGraphNode {
  type: 'function';
  /** Function to execute with context */
  fn: (context: any) => Promise<unknown> | unknown;
}

/**
 * Conditional node - evaluates a condition (edges determine branches)
 */
export interface ConditionalGraphNode extends BaseGraphNode {
  type: 'conditional';
  /** Condition function to evaluate */
  condition: (context: any) => boolean | Promise<boolean>;
}

/**
 * Pipeline node - executes another registered pipeline
 */
export interface PipelineGraphNode extends BaseGraphNode {
  type: 'pipeline';
  /** ID of the registered pipeline to execute */
  pipelineId: string;
}

/**
 * Discriminated union of executable graph nodes
 */
export type GraphNode = AgentGraphNode | FunctionGraphNode | ConditionalGraphNode | PipelineGraphNode;

/**
 * Fork node - explicitly splits execution into parallel branches
 */
export interface ForkNode {
  type: 'fork';
  /** Unique node identifier */
  id: string;
  /** Node IDs to execute in parallel */
  branches: string[];
}

/**
 * Join node - waits for multiple parallel branches to complete
 */
export interface JoinNode {
  type: 'join';
  /** Unique node identifier */
  id: string;
  /** Node IDs to wait for */
  sources: string[];
  /** How to merge outputs from source nodes */
  mergeStrategy: 'shallow-merge' | 'array';
}

/**
 * Union of all node types (executable + control flow)
 */
export type AnyGraphNode = GraphNode | ForkNode | JoinNode;

/**
 * Graph workflow configuration
 */
export interface GraphWorkflowConfig {
  /** Unique workflow identifier */
  id: string;
  /** Discriminant for graph workflows */
  type: 'graph';
  /** Array of nodes in the graph */
  nodes: AnyGraphNode[];
  /** Edges connecting nodes */
  edges: GraphEdge[];
  /** ID of the entry node where execution begins */
  entryNode: string;
  /** Agent handoff constraints (source agent ID -> allowed target agent IDs) */
  handoffs?: Record<string, string[]>;
  /** Optional hooks for workflow lifecycle events */
  hooks?: PipelineHooks;
}

/**
 * Type guard to check if a config is a graph workflow
 * @param config - Configuration to check
 * @returns true if config is GraphWorkflowConfig
 */
export function isGraphWorkflowConfig(config: unknown): config is GraphWorkflowConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    config.type === 'graph' &&
    'nodes' in config &&
    Array.isArray((config as any).nodes) &&
    'edges' in config &&
    Array.isArray((config as any).edges) &&
    'entryNode' in config &&
    typeof (config as any).entryNode === 'string'
  );
}
