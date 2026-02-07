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
  test('evaluates layered rules deterministically with deny precedence', async () => {
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

  test('filters tool lists with context conditions', async () => {
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
});
