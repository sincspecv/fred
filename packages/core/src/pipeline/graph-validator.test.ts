/**
 * Graph Validator Tests
 *
 * Tests for graph workflow validation including cycle detection,
 * structure validation, and default branch requirements.
 */

import { describe, test, expect } from 'bun:test';
import { validateGraphWorkflow, GraphValidationError } from './graph-validator';
import type { GraphWorkflowConfig } from './graph';

describe('Graph Validator', () => {
  test('validates a simple valid DAG', () => {
    const validGraph: GraphWorkflowConfig = {
      id: 'valid-graph',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        { type: 'agent', id: 'start', agentId: 'agent1' },
        { type: 'agent', id: 'end', agentId: 'agent2' },
      ],
      edges: [
        { from: 'start', to: 'end' },
      ],
    };

    expect(() => validateGraphWorkflow(validGraph)).not.toThrow();
  });

  test('rejects cyclic graph (A -> B -> C -> A)', () => {
    const cyclicGraph: GraphWorkflowConfig = {
      id: 'cyclic-graph',
      type: 'graph',
      entryNode: 'A',
      nodes: [
        { type: 'agent', id: 'A', agentId: 'agent1' },
        { type: 'agent', id: 'B', agentId: 'agent2' },
        { type: 'agent', id: 'C', agentId: 'agent3' },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'A' }, // Creates cycle
      ],
    };

    expect(() => validateGraphWorkflow(cyclicGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(cyclicGraph)).toThrow(/contains a cycle/);
  });

  test('rejects graph with missing entry node', () => {
    const invalidGraph: GraphWorkflowConfig = {
      id: 'missing-entry',
      type: 'graph',
      entryNode: 'nonexistent',
      nodes: [
        { type: 'agent', id: 'start', agentId: 'agent1' },
      ],
      edges: [],
    };

    expect(() => validateGraphWorkflow(invalidGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(invalidGraph)).toThrow(/entry node.*does not exist/);
  });

  test('rejects graph with missing default branch at decision point', () => {
    const noDefaultGraph: GraphWorkflowConfig = {
      id: 'no-default',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        { type: 'agent', id: 'start', agentId: 'agent1' },
        { type: 'agent', id: 'branch1', agentId: 'agent2' },
        { type: 'agent', id: 'branch2', agentId: 'agent3' },
      ],
      edges: [
        {
          from: 'start',
          to: 'branch1',
          condition: { field: 'start.result', operator: 'equals', value: 'A' },
        },
        {
          from: 'start',
          to: 'branch2',
          condition: { field: 'start.result', operator: 'equals', value: 'B' },
        },
      ],
    };

    expect(() => validateGraphWorkflow(noDefaultGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(noDefaultGraph)).toThrow(/no default edge/);
  });

  test('accepts graph with default branch at decision point', () => {
    const withDefaultGraph: GraphWorkflowConfig = {
      id: 'with-default',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        { type: 'agent', id: 'start', agentId: 'agent1' },
        { type: 'agent', id: 'branch1', agentId: 'agent2' },
        { type: 'agent', id: 'branch2', agentId: 'agent3' },
      ],
      edges: [
        {
          from: 'start',
          to: 'branch1',
          condition: { field: 'start.result', operator: 'equals', value: 'A' },
        },
        {
          from: 'start',
          to: 'branch2',
          default: true, // Default branch
        },
      ],
    };

    expect(() => validateGraphWorkflow(withDefaultGraph)).not.toThrow();
  });

  test('rejects graph with invalid edge references', () => {
    const invalidEdgeGraph: GraphWorkflowConfig = {
      id: 'invalid-edge',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        { type: 'agent', id: 'start', agentId: 'agent1' },
      ],
      edges: [
        { from: 'start', to: 'nonexistent' }, // Invalid target
      ],
    };

    expect(() => validateGraphWorkflow(invalidEdgeGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(invalidEdgeGraph)).toThrow(/non-existent target node/);
  });

  test('rejects graph with invalid fork branch references', () => {
    const invalidForkGraph: GraphWorkflowConfig = {
      id: 'invalid-fork',
      type: 'graph',
      entryNode: 'fork1',
      nodes: [
        { type: 'fork', id: 'fork1', branches: ['branch1', 'nonexistent'] },
        { type: 'agent', id: 'branch1', agentId: 'agent1' },
      ],
      edges: [],
    };

    expect(() => validateGraphWorkflow(invalidForkGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(invalidForkGraph)).toThrow(/non-existent branch/);
  });

  test('rejects graph with invalid join source references', () => {
    const invalidJoinGraph: GraphWorkflowConfig = {
      id: 'invalid-join',
      type: 'graph',
      entryNode: 'source1',
      nodes: [
        { type: 'agent', id: 'source1', agentId: 'agent1' },
        { type: 'join', id: 'join1', sources: ['source1', 'nonexistent'], mergeStrategy: 'shallow-merge' },
      ],
      edges: [
        { from: 'source1', to: 'join1' },
      ],
    };

    expect(() => validateGraphWorkflow(invalidJoinGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(invalidJoinGraph)).toThrow(/non-existent source/);
  });

  test('rejects graph with duplicate node IDs', () => {
    const duplicateGraph: GraphWorkflowConfig = {
      id: 'duplicate-nodes',
      type: 'graph',
      entryNode: 'node1',
      nodes: [
        { type: 'agent', id: 'node1', agentId: 'agent1' },
        { type: 'agent', id: 'node1', agentId: 'agent2' }, // Duplicate ID
      ],
      edges: [],
    };

    expect(() => validateGraphWorkflow(duplicateGraph)).toThrow(GraphValidationError);
    expect(() => validateGraphWorkflow(duplicateGraph)).toThrow(/duplicate node IDs/);
  });
});
