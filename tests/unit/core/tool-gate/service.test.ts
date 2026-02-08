import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { createHash } from 'crypto';
import type { ToolPoliciesConfig } from '../../../../packages/core/src/config/types';
import { ToolGateService, ToolGateServiceLive } from '../../../../packages/core/src/tool-gate/service';
import type { ToolGateContext, ToolGateServiceApi, PolicyAuditEvent } from '../../../../packages/core/src/tool-gate/types';
import { ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import type { Tool } from '../../../../packages/core/src/tool/tool';
import type { HookManagerService } from '../../../../packages/core/src/hooks/service';
import { HookManagerService as HookManagerServiceTag } from '../../../../packages/core/src/hooks/service';
import type { HookEvent } from '../../../../packages/core/src/hooks/types';
import type { ObservabilityService } from '../../../../packages/core/src/observability/service';
import { ObservabilityService as ObservabilityServiceTag } from '../../../../packages/core/src/observability/service';

const testTool = (id: string, capabilities: string[] = []): Tool => ({
  id,
  name: id,
  description: `tool ${id}`,
  capabilities,
  execute: () => `executed:${id}`,
});

const ToolGateTestLayer = ToolGateServiceLive.pipe(
  Layer.provide(ToolRegistryServiceLive)
);

const runWithToolGate = <A, E>(effect: Effect.Effect<A, E, ToolGateServiceApi>) =>
  Effect.runPromise(effect.pipe(Effect.provide(ToolGateTestLayer)));

// Mock HookManagerService that collects events
const createMockHookManager = () => {
  const events: HookEvent[] = [];

  const mockService: HookManagerService = {
    registerHook: () => Effect.succeed(undefined),
    unregisterHook: () => Effect.succeed(false),
    executeHooks: (type, event) => Effect.sync(() => {
      events.push(event);
      return [];
    }),
    executeHooksAndMerge: () => Effect.succeed({}),
    clearHooks: () => Effect.succeed(undefined),
    clearAllHooks: () => Effect.succeed(undefined),
    getRegisteredHookTypes: () => Effect.succeed([]),
    getHookCount: () => Effect.succeed(0),
  };

  return { mockService, events };
};

// Mock ObservabilityService with deterministic hashing
const createMockObservability = () => {
  const mockService: ObservabilityService = {
    hashPayload: (payload) => Effect.sync(() => {
      const hash = createHash('sha256');
      hash.update(JSON.stringify(payload));
      return hash.digest('hex').slice(0, 16);
    }),
    logStructured: () => Effect.succeed(undefined),
    recordMetric: () => Effect.succeed(undefined),
    recordTokenUsage: () => Effect.succeed(undefined),
    recordCost: () => Effect.succeed(undefined),
    recordHookEvent: () => Effect.succeed(undefined),
    startRun: () => Effect.succeed(undefined),
    recordHook: () => Effect.succeed(undefined),
    recordStep: () => Effect.succeed(undefined),
    recordTool: () => Effect.succeed(undefined),
    recordModel: () => Effect.succeed(undefined),
    endRun: () => Effect.succeed(undefined),
    getTraceIdByRunId: () => Effect.succeed(undefined),
    exportTrace: () => Effect.succeed(undefined),
    evaluateSampling: () => Effect.succeed({ shouldSample: true, reason: 'debug' as const }),
  } as any;

  return mockService;
};

describe('ToolGateService', () => {
  test('evaluates default -> intent -> agent deterministically with deny precedence', async () => {
    const policies: ToolPoliciesConfig = {
      default: { allow: ['write-report'] },
      intents: { reporting: { deny: ['write-report'] } },
      agents: { analyst: { allow: ['write-report'] } },
    };

    const context: ToolGateContext = {
      intentId: 'reporting',
      agentId: 'analyst',
    };

    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.setPolicies(policies);
        return yield* toolGate.evaluateTool(
          {
            id: 'write-report',
            capabilities: ['write'],
          },
          context
        );
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.deniedBy?.scope).toBe('intent');
    expect(result.matchedRules.map((rule) => `${rule.scope}:${rule.effect}`)).toEqual([
      'default:allow',
      'intent:deny',
      'agent:allow',
    ]);
  });

  test('applies deny when required categories are missing', async () => {
    const policies: ToolPoliciesConfig = {
      default: {
        allow: ['publish-release'],
        requiredCategories: ['admin'],
      },
    };

    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.setPolicies(policies);
        return yield* toolGate.evaluateTool({
          id: 'publish-release',
          capabilities: ['write'],
        }, {});
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.deniedBy?.reason).toContain('missing-required-categories:admin');
  });

  test('applies explicit overrides instead of inherited policy chain', async () => {
    const policies: ToolPoliciesConfig = {
      default: { deny: ['shutdown-cluster'] },
      overrides: [
        {
          id: 'incident-response-override',
          override: true,
          target: {
            intentId: 'incident',
            agentId: 'oncall',
          },
          allow: ['shutdown-cluster'],
          conditions: {
            role: 'admin',
          },
        },
      ],
    };

    const context: ToolGateContext = {
      intentId: 'incident',
      agentId: 'oncall',
      role: 'admin',
    };

    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.setPolicies(policies);
        return yield* toolGate.evaluateTool({ id: 'shutdown-cluster' }, context);
      })
    );

    expect(result.allowed).toBe(true);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.matchedRules[0]).toMatchObject({
      scope: 'override',
      source: 'incident-response-override',
      effect: 'allow',
    });
  });

  test('filters tool lists using role-scoped conditions', async () => {
    const tools = [testTool('create-ticket', ['write']), testTool('delete-ticket', ['destructive'])];

    const policies: ToolPoliciesConfig = {
      default: {
        allow: ['create-ticket', 'delete-ticket'],
      },
      intents: {
        support: {
          deny: ['delete-ticket'],
          conditions: {
            role: ['viewer', 'agent'],
          },
        },
      },
    };

    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.setPolicies(policies);
        return yield* toolGate.filterTools(tools, {
          intentId: 'support',
          role: 'agent',
        });
      })
    );

    expect(result.allowed.map((tool) => tool.id)).toEqual(['create-ticket']);
    expect(result.denied.map((decision) => decision.toolId)).toEqual(['delete-ticket']);
  });

  test('supports metadata predicates in conditions', async () => {
    const policies: ToolPoliciesConfig = {
      intents: {
        billing: {
          allow: ['refund-charge'],
          conditions: {
            metadata: {
              tenant: { equals: 'acme' },
              region: { in: ['us', 'ca'] },
            },
          },
        },
      },
    };

    const allowedContext: ToolGateContext = {
      intentId: 'billing',
      metadata: {
        tenant: 'acme',
        region: 'us',
      },
    };

    const deniedContext: ToolGateContext = {
      intentId: 'billing',
      metadata: {
        tenant: 'acme',
        region: 'eu',
      },
    };

    const [allowed, denied] = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.setPolicies(policies);
        const allowedDecision = yield* toolGate.evaluateTool({ id: 'refund-charge' }, allowedContext);
        const deniedDecision = yield* toolGate.evaluateTool({ id: 'refund-charge' }, deniedContext);
        return [allowedDecision, deniedDecision] as const;
      })
    );

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  test('setPolicies updates decisions immediately', async () => {
    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;

        yield* toolGate.setPolicies({
          default: {
            allow: ['rotate-key'],
          },
        });

        const before = yield* toolGate.evaluateTool({ id: 'rotate-key' }, {});

        yield* toolGate.setPolicies({
          default: {
            deny: ['rotate-key'],
          },
        });

        const after = yield* toolGate.evaluateTool({ id: 'rotate-key' }, {});

        return { before, after };
      })
    );

    expect(result.before.allowed).toBe(true);
    expect(result.after.allowed).toBe(false);
  });

  test('reloadPolicies replaces behavior with no stale decision cache', async () => {
    const result = await runWithToolGate(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;

        yield* toolGate.setPolicies({
          intents: {
            support: {
              allow: ['delete-ticket'],
            },
          },
        });

        const before = yield* toolGate.evaluateTool(
          { id: 'delete-ticket', capabilities: ['destructive'] },
          { intentId: 'support' }
        );

        yield* toolGate.reloadPolicies({
          intents: {
            support: {
              deny: ['delete-ticket'],
            },
          },
        });

        const after = yield* toolGate.evaluateTool(
          { id: 'delete-ticket', capabilities: ['destructive'] },
          { intentId: 'support' }
        );

        return { before, after };
      })
    );

    expect(result.before.allowed).toBe(true);
    expect(result.after.allowed).toBe(false);
    expect(result.after.deniedBy?.effect).toBe('deny');
  });

  describe('policy audit events', () => {
    test('emits afterPolicyDecision with allow outcome', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { allow: ['write-report'] },
      };

      const context: ToolGateContext = {
        intentId: 'reporting',
        agentId: 'analyst',
        userId: 'user-123',
        role: 'admin',
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'write-report', capabilities: ['write'] }, context);
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.type).toBe('afterPolicyDecision');

      const auditData = event.data as PolicyAuditEvent;
      expect(auditData.outcome).toBe('allow');
      expect(auditData.toolId).toBe('write-report');
      expect(auditData.intentId).toBe('reporting');
      expect(auditData.agentId).toBe('analyst');
      expect(auditData.userId).toBe('user-123');
      expect(auditData.role).toBe('admin');
      expect(auditData.matchedRules).toHaveLength(1);
      expect(auditData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('emits afterPolicyDecision with deny outcome', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { deny: ['delete-database'] },
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'delete-database' }, {});
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const auditData = events[0].data as PolicyAuditEvent;
      expect(auditData.outcome).toBe('deny');
      expect(auditData.deniedBy).toBeDefined();
      expect(auditData.deniedBy?.effect).toBe('deny');
    });

    test('emits afterPolicyDecision with requireApproval outcome', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { requireApproval: ['deploy-production'] },
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'deploy-production' }, {});
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const auditData = events[0].data as PolicyAuditEvent;
      expect(auditData.outcome).toBe('requireApproval');
    });

    test('includes hashed arguments in audit event', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { allow: ['send-email'] },
      };

      const context: ToolGateContext = {
        metadata: {
          recipient: 'user@example.com',
          subject: 'Test email',
        },
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'send-email' }, context);
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const auditData = events[0].data as PolicyAuditEvent;
      expect(auditData.argsHash).toBeDefined();
      expect(auditData.argsHash).toHaveLength(16);
      expect(auditData.argsHash).toMatch(/^[0-9a-f]+$/);
    });

    test('includes matched rules in audit event', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { allow: ['write-report'] },
        intents: { reporting: { allow: ['write-report'] } },
        agents: { analyst: { deny: ['write-report'] } },
      };

      const context: ToolGateContext = {
        intentId: 'reporting',
        agentId: 'analyst',
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'write-report' }, context);
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const auditData = events[0].data as PolicyAuditEvent;
      expect(auditData.matchedRules).toHaveLength(3);
      expect(auditData.matchedRules.map((r) => `${r.scope}:${r.effect}`)).toEqual([
        'default:allow',
        'intent:allow',
        'agent:deny',
      ]);
    });

    test('includes timestamp in audit event', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { allow: ['test-tool'] },
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.evaluateTool({ id: 'test-tool' }, {});
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      const auditData = events[0].data as PolicyAuditEvent;
      expect(auditData.timestamp).toBeDefined();

      // Verify it's a valid ISO 8601 timestamp
      const timestamp = new Date(auditData.timestamp);
      expect(timestamp.toISOString()).toBe(auditData.timestamp);
    });

    test('audit emission failure does not break gate decision', async () => {
      // Create a hook manager that throws
      const throwingHookManager: HookManagerService = {
        registerHook: () => Effect.succeed(undefined),
        unregisterHook: () => Effect.succeed(false),
        executeHooks: () => Effect.fail(new Error('Hook execution failed')),
        executeHooksAndMerge: () => Effect.fail(new Error('Hook execution failed')),
        clearHooks: () => Effect.succeed(undefined),
        clearAllHooks: () => Effect.succeed(undefined),
        getRegisteredHookTypes: () => Effect.succeed([]),
        getHookCount: () => Effect.succeed(0),
      };

      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, throwingHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const policies: ToolPoliciesConfig = {
        default: { allow: ['test-tool'] },
      };

      // This should not throw even though hooks fail
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          return yield* toolGate.evaluateTool({ id: 'test-tool' }, {});
        }).pipe(Effect.provide(testLayer))
      );

      // Gate decision should still work
      expect(result.allowed).toBe(true);
      expect(result.toolId).toBe('test-tool');
    });

    test('filterTools emits one audit event per tool', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const mockObservability = createMockObservability();

      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const obsLayer = Layer.succeed(ObservabilityServiceTag, mockObservability);

      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, Layer.merge(hookLayer, obsLayer)))
      );

      const tools = [
        testTool('tool-a'),
        testTool('tool-b'),
        testTool('tool-c'),
      ];

      const policies: ToolPoliciesConfig = {
        default: { allow: ['tool-a', 'tool-b', 'tool-c'] },
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.setPolicies(policies);
          yield* toolGate.filterTools(tools, {});
        }).pipe(Effect.provide(testLayer))
      );

      // Should emit 3 events (one per tool)
      expect(events).toHaveLength(3);
      expect(events.map((e) => (e.data as PolicyAuditEvent).toolId)).toEqual([
        'tool-a',
        'tool-b',
        'tool-c',
      ]);
    });
  });

  describe('approval workflow', () => {
    test('createApprovalRequest returns request for requireApproval decision', async () => {
      const decision = {
        toolId: 'test-tool',
        allowed: true,
        requireApproval: true,
        matchedRules: [{ scope: 'default' as const, source: 'default', effect: 'requireApproval' as const }],
      };

      const context = {
        intentId: 'test-intent',
        agentId: 'test-agent',
        userId: 'user-123',
        metadata: { conversationId: 'conv-456' },
      };

      const request = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          return yield* toolGate.createApprovalRequest(decision, context);
        })
      );

      expect(request).toBeDefined();
      expect(request?.toolId).toBe('test-tool');
      expect(request?.intentId).toBe('test-intent');
      expect(request?.agentId).toBe('test-agent');
      expect(request?.userId).toBe('user-123');
      expect(request?.sessionKey).toBe('conv-456');
      expect(request?.ttlMs).toBe(300000);
      expect(request?.reason).toBeDefined();
    });

    test('createApprovalRequest returns undefined for already-approved tool', async () => {
      const decision = {
        toolId: 'test-tool',
        allowed: true,
        requireApproval: true,
        matchedRules: [{ scope: 'default' as const, source: 'default', effect: 'requireApproval' as const }],
      };

      const context = {
        metadata: { conversationId: 'conv-456' },
      };

      const result = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          // Record approval first
          yield* toolGate.recordApproval('test-tool', 'conv-456', true);
          // Now try to create approval request
          return yield* toolGate.createApprovalRequest(decision, context);
        })
      );

      expect(result).toBeUndefined();
    });

    test('hasApproval returns false for unapproved tool', async () => {
      const hasApproval = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          return yield* toolGate.hasApproval('test-tool', 'session-1');
        })
      );

      expect(hasApproval).toBe(false);
    });

    test('hasApproval returns true after recordApproval(true)', async () => {
      const hasApproval = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('test-tool', 'session-1', true);
          return yield* toolGate.hasApproval('test-tool', 'session-1');
        })
      );

      expect(hasApproval).toBe(true);
    });

    test('hasApproval returns false after recordApproval(false)', async () => {
      const hasApproval = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('test-tool', 'session-1', false);
          return yield* toolGate.hasApproval('test-tool', 'session-1');
        })
      );

      expect(hasApproval).toBe(false);
    });

    test('clearApprovals removes session-scoped approvals', async () => {
      const hasApproval = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('test-tool', 'session-1', true);
          yield* toolGate.clearApprovals('session-1');
          return yield* toolGate.hasApproval('test-tool', 'session-1');
        })
      );

      expect(hasApproval).toBe(false);
    });

    test('clearApprovals without sessionKey clears all', async () => {
      const result = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('tool-a', 'session-1', true);
          yield* toolGate.recordApproval('tool-b', 'session-2', true);
          yield* toolGate.clearApprovals();
          const hasA = yield* toolGate.hasApproval('tool-a', 'session-1');
          const hasB = yield* toolGate.hasApproval('tool-b', 'session-2');
          return { hasA, hasB };
        })
      );

      expect(result.hasA).toBe(false);
      expect(result.hasB).toBe(false);
    });

    test('approval does not carry across sessions', async () => {
      const result = await runWithToolGate(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('test-tool', 'session-A', true);
          const hasInA = yield* toolGate.hasApproval('test-tool', 'session-A');
          const hasInB = yield* toolGate.hasApproval('test-tool', 'session-B');
          return { hasInA, hasInB };
        })
      );

      expect(result.hasInA).toBe(true);
      expect(result.hasInB).toBe(false);
    });

    test('recordApproval emits audit event', async () => {
      const { mockService: mockHookManager, events } = createMockHookManager();
      const hookLayer = Layer.succeed(HookManagerServiceTag, mockHookManager);
      const testLayer = ToolGateServiceLive.pipe(
        Layer.provide(Layer.merge(ToolRegistryServiceLive, hookLayer))
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const toolGate = yield* ToolGateService;
          yield* toolGate.recordApproval('test-tool', 'session-1', true);
        }).pipe(Effect.provide(testLayer))
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('afterPolicyDecision');
      const eventData = events[0].data as any;
      expect(eventData.toolId).toBe('test-tool');
      expect(eventData.outcome).toBe('allow');
      expect(eventData.metadata.approvalResponse).toBe(true);
      expect(eventData.metadata.sessionKey).toBe('session-1');
    });
  });
});
