import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import type { ToolPoliciesConfig } from '../../../../packages/core/src/config/types';
import { ToolGateService, ToolGateServiceLive } from '../../../../packages/core/src/tool-gate/service';
import type { ToolGateContext, ToolGateServiceApi } from '../../../../packages/core/src/tool-gate/types';
import { ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import type { Tool } from '../../../../packages/core/src/tool/tool';

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
});
