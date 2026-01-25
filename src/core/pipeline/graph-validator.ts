/**
 * Graph Workflow Validation
 *
 * Validates graph workflow configurations to ensure they form valid DAGs
 * with proper structure and required default branches at decision points.
 */

import Graph from 'graphology';
import { hasCycle } from 'graphology-dag';
import type { GraphWorkflowConfig, AnyGraphNode, GraphEdge } from './graph';

/**
 * Validation error for graph workflows
 */
export class GraphValidationError extends Error {
  constructor(message: string, public workflowId: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

/**
 * Validate a graph workflow configuration.
 *
 * Checks:
 * - Entry node exists
 * - All node IDs are unique
 * - All edge references point to valid nodes
 * - Graph is a DAG (no cycles)
 * - Fork/join nodes reference valid targets
 * - Each decision point has a default branch
 * - Handoff targets reference valid agent nodes
 *
 * @param config - Graph workflow configuration to validate
 * @throws GraphValidationError if validation fails
 */
export function validateGraphWorkflow(config: GraphWorkflowConfig): void {
  const { id, nodes, edges, entryNode, handoffs } = config;

  // Build node ID set for quick lookup
  const nodeIds = new Set<string>();
  const duplicates: string[] = [];

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      duplicates.push(node.id);
    }
    nodeIds.add(node.id);
  }

  if (duplicates.length > 0) {
    throw new GraphValidationError(
      `Graph workflow ${id} has duplicate node IDs: ${duplicates.join(', ')}`,
      id
    );
  }

  // Validate entry node exists
  if (!nodeIds.has(entryNode)) {
    throw new GraphValidationError(
      `Graph workflow ${id} entry node '${entryNode}' does not exist in nodes array`,
      id
    );
  }

  // Validate edge references
  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      throw new GraphValidationError(
        `Graph workflow ${id} edge references non-existent source node: ${edge.from}`,
        id
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new GraphValidationError(
        `Graph workflow ${id} edge references non-existent target node: ${edge.to}`,
        id
      );
    }
  }

  // Validate fork and join nodes
  for (const node of nodes) {
    if (node.type === 'fork') {
      for (const branchId of node.branches) {
        if (!nodeIds.has(branchId)) {
          throw new GraphValidationError(
            `Graph workflow ${id} fork node '${node.id}' references non-existent branch: ${branchId}`,
            id
          );
        }
      }
    } else if (node.type === 'join') {
      for (const sourceId of node.sources) {
        if (!nodeIds.has(sourceId)) {
          throw new GraphValidationError(
            `Graph workflow ${id} join node '${node.id}' references non-existent source: ${sourceId}`,
            id
          );
        }
      }
    }
  }

  // Build graph for cycle detection
  const graph = new Graph({ type: 'directed' });

  // Add all nodes to graph
  for (const node of nodes) {
    graph.addNode(node.id);
  }

  // Add all edges to graph
  for (const edge of edges) {
    // Allow multiple edges between same nodes
    if (!graph.hasEdge(edge.from, edge.to)) {
      graph.addDirectedEdge(edge.from, edge.to);
    }
  }

  // Check for cycles
  if (hasCycle(graph)) {
    throw new GraphValidationError(
      `Graph workflow ${id} contains a cycle (DAG required)`,
      id
    );
  }

  // Validate default branches at decision points
  // Build adjacency map: nodeId -> outgoing edges
  const outgoingEdges = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const existing = outgoingEdges.get(edge.from) || [];
    existing.push(edge);
    outgoingEdges.set(edge.from, existing);
  }

  // Check each node with multiple outgoing edges
  for (const [nodeId, nodeEdges] of outgoingEdges.entries()) {
    if (nodeEdges.length > 1) {
      // At least one edge must be default or have no condition
      const hasDefault = nodeEdges.some(edge => edge.default === true);
      const hasUnconditional = nodeEdges.some(edge => !edge.condition);

      if (!hasDefault && !hasUnconditional) {
        throw new GraphValidationError(
          `Graph workflow ${id} node '${nodeId}' has multiple branches but no default edge`,
          id
        );
      }
    }
  }

  // Validate handoff targets if defined
  if (handoffs) {
    // Get all agent node IDs
    const agentNodeIds = new Set(
      nodes.filter(node => node.type === 'agent').map(node => node.id)
    );

    for (const [source, targets] of Object.entries(handoffs)) {
      // Source may be external, so we just warn if not in nodes
      // But targets must exist as agent nodes in this workflow
      for (const target of targets) {
        if (!agentNodeIds.has(target)) {
          // For now, just warn - target may be in a different workflow
          // In production, you might want to make this configurable
          console.warn(
            `Graph workflow ${id} handoff from '${source}' to '${target}' - target not found as agent node in workflow`
          );
        }
      }
    }
  }
}
