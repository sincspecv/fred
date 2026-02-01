import { describe, test, expect } from 'bun:test';
import { GraphWorkflowBuilder } from '../../../../packages/core/src/pipeline/graph-builder';
import { GraphWorkflowConfig } from '../../../../packages/core/src/pipeline/graph';
import { GraphValidationError } from '../../../../packages/core/src/pipeline/graph-validator';

describe('GraphWorkflowBuilder', () => {
  test('creates valid GraphWorkflowConfig', () => {
    const workflow = new GraphWorkflowBuilder('test-workflow')
      .addNode('start', { type: 'agent', agentId: 'starter' })
      .addNode('end', { type: 'agent', agentId: 'ender' })
      .addEdge('start', 'end')
      .setEntry('start')
      .build();

    expect(workflow.id).toBe('test-workflow');
    expect(workflow.type).toBe('graph');
    expect(workflow.nodes).toHaveLength(2);
    expect(workflow.edges).toHaveLength(1);
    expect(workflow.entryNode).toBe('start');
  });

  test('throws error when entry node not set', () => {
    const builder = new GraphWorkflowBuilder('no-entry')
      .addNode('node1', { type: 'agent', agentId: 'agent1' });

    expect(() => builder.build()).toThrow('must have an entry node');
  });

  test('throws error for duplicate node ID', () => {
    const builder = new GraphWorkflowBuilder('dup-test')
      .addNode('duplicate', { type: 'agent', agentId: 'agent1' });

    expect(() => builder.addNode('duplicate', { type: 'agent', agentId: 'agent2' }))
      .toThrow('Node ID "duplicate" already exists');
  });

  test('detects cycles via build validation', () => {
    const builder = new GraphWorkflowBuilder('cycle-test')
      .addNode('a', { type: 'agent', agentId: 'agent-a' })
      .addNode('b', { type: 'agent', agentId: 'agent-b' })
      .addNode('c', { type: 'agent', agentId: 'agent-c' })
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', 'a')  // Creates cycle
      .setEntry('a');

    expect(() => builder.build()).toThrow(GraphValidationError);
    expect(() => builder.build()).toThrow('contains a cycle');
  });

  test('setDefaultEdge sets default flag on edge', () => {
    const workflow = new GraphWorkflowBuilder('default-test')
      .addNode('decision', { type: 'conditional', condition: (ctx) => ctx.value > 10 })
      .addNode('high', { type: 'agent', agentId: 'high-handler' })
      .addNode('low', { type: 'agent', agentId: 'low-handler' })
      .addEdge('decision', 'high', {
        condition: { field: 'decision.result', operator: 'equals', value: true }
      })
      .setDefaultEdge('decision', 'low')
      .setEntry('decision')
      .build();

    const defaultEdge = workflow.edges.find(e => e.default === true);
    expect(defaultEdge).toBeDefined();
    expect(defaultEdge?.from).toBe('decision');
    expect(defaultEdge?.to).toBe('low');
  });

  test('supports all node types', () => {
    const workflow = new GraphWorkflowBuilder('all-types')
      .addNode('agent-node', { type: 'agent', agentId: 'my-agent' })
      .addNode('fn-node', { type: 'function', fn: async (ctx) => ({ result: 'ok' }) })
      .addNode('cond-node', { type: 'conditional', condition: (ctx) => true })
      .addNode('pipeline-node', { type: 'pipeline', pipelineId: 'sub-pipeline' })
      .addEdge('agent-node', 'fn-node')
      .addEdge('fn-node', 'cond-node')
      .addEdge('cond-node', 'pipeline-node')
      .setEntry('agent-node')
      .build();

    expect(workflow.nodes).toHaveLength(4);
    const types = workflow.nodes.map(n => n.type);
    expect(types).toContain('agent');
    expect(types).toContain('function');
    expect(types).toContain('conditional');
    expect(types).toContain('pipeline');
  });

  test('adds fork and join nodes', () => {
    const workflow = new GraphWorkflowBuilder('fork-join-test')
      .addNode('start', { type: 'agent', agentId: 'starter' })
      .addForkNode('fork', ['branch-a', 'branch-b'])
      .addNode('branch-a', { type: 'agent', agentId: 'agent-a' })
      .addNode('branch-b', { type: 'agent', agentId: 'agent-b' })
      .addJoinNode('join', ['branch-a', 'branch-b'], 'shallow-merge')
      .addNode('end', { type: 'agent', agentId: 'ender' })
      .addEdge('start', 'fork')
      .addEdge('join', 'end')
      .setEntry('start')
      .build();

    const forkNode = workflow.nodes.find(n => n.type === 'fork') as any;
    expect(forkNode).toBeDefined();
    expect(forkNode.branches).toEqual(['branch-a', 'branch-b']);

    const joinNode = workflow.nodes.find(n => n.type === 'join') as any;
    expect(joinNode).toBeDefined();
    expect(joinNode.sources).toEqual(['branch-a', 'branch-b']);
    expect(joinNode.mergeStrategy).toBe('shallow-merge');
  });

  test('configures handoffs', () => {
    const workflow = new GraphWorkflowBuilder('handoff-test')
      .addNode('reviewer', { type: 'agent', agentId: 'reviewer' })
      .addNode('approver', { type: 'agent', agentId: 'approver' })
      .allowHandoff('reviewer', ['approver'])
      .addEdge('reviewer', 'approver')
      .setEntry('reviewer')
      .build();

    expect(workflow.handoffs).toBeDefined();
    expect(workflow.handoffs?.['reviewer']).toEqual(['approver']);
  });

  test('sets hooks', () => {
    const beforePipelineHandler = async () => {};
    const afterPipelineHandler = async () => {};

    const workflow = new GraphWorkflowBuilder('hooks-test')
      .addNode('node1', { type: 'agent', agentId: 'agent1' })
      .setEntry('node1')
      .setHooks({
        beforePipeline: [beforePipelineHandler],
        afterPipeline: [afterPipelineHandler],
      })
      .build();

    expect(workflow.hooks).toBeDefined();
    expect(workflow.hooks?.beforePipeline).toHaveLength(1);
    expect(workflow.hooks?.afterPipeline).toHaveLength(1);
  });

  test('fluent chaining works', () => {
    // Test that all methods return 'this' for chaining
    const builder = new GraphWorkflowBuilder('chain-test');

    const result = builder
      .addNode('n1', { type: 'agent', agentId: 'a1' })
      .addNode('n2', { type: 'agent', agentId: 'a2' })
      .addForkNode('fork', ['n1', 'n2'])
      .addJoinNode('join', ['n1', 'n2'])
      .addEdge('n1', 'n2')
      .setDefaultEdge('n1', 'n2')
      .allowHandoff('a1', ['a2'])
      .setEntry('n1')
      .setHooks({});

    // Should return builder until build() is called
    expect(result).toBe(builder);

    // build() returns config
    const config = builder.build();
    expect(config).not.toBe(builder);
    expect(config.type).toBe('graph');
  });

  test('exposes fields from node output', () => {
    const workflow = new GraphWorkflowBuilder('expose-test')
      .addNode('step1', {
        type: 'agent',
        agentId: 'agent1',
        expose: ['decision', 'score']
      })
      .addNode('step2', { type: 'agent', agentId: 'agent2' })
      .addEdge('step1', 'step2')
      .setEntry('step1')
      .build();

    const step1 = workflow.nodes.find(n => n.id === 'step1') as any;
    expect(step1.expose).toEqual(['decision', 'score']);
  });

  test('validates missing default branch at decision point', () => {
    const builder = new GraphWorkflowBuilder('missing-default')
      .addNode('decision', { type: 'conditional', condition: (ctx) => true })
      .addNode('a', { type: 'agent', agentId: 'agent-a' })
      .addNode('b', { type: 'agent', agentId: 'agent-b' })
      .addEdge('decision', 'a', {
        condition: { field: 'decision.value', operator: 'equals', value: 'a' }
      })
      .addEdge('decision', 'b', {
        condition: { field: 'decision.value', operator: 'equals', value: 'b' }
      })
      .setEntry('decision');

    // Should throw because decision has 2 conditional edges but no default
    expect(() => builder.build()).toThrow(GraphValidationError);
    expect(() => builder.build()).toThrow('no default edge');
  });

  test('allows decision point with unconditional edge', () => {
    // One unconditional edge acts as implicit default
    const workflow = new GraphWorkflowBuilder('implicit-default')
      .addNode('decision', { type: 'conditional', condition: (ctx) => true })
      .addNode('a', { type: 'agent', agentId: 'agent-a' })
      .addNode('b', { type: 'agent', agentId: 'agent-b' })
      .addEdge('decision', 'a', {
        condition: { field: 'decision.value', operator: 'equals', value: 'a' }
      })
      .addEdge('decision', 'b')  // No condition = unconditional = acts as default
      .setEntry('decision')
      .build();

    expect(workflow.edges).toHaveLength(2);
    const unconditionalEdge = workflow.edges.find(e => !e.condition && !e.default);
    expect(unconditionalEdge).toBeDefined();
  });

  test('throws descriptive error for invalid workflow ID', () => {
    expect(() => new GraphWorkflowBuilder('')).toThrow('Workflow ID is required');
    expect(() => new GraphWorkflowBuilder('  ')).toThrow('Workflow ID is required');
  });
});
