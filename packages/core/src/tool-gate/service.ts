import { Context, Effect, Layer, Ref } from 'effect';
import type {
  ToolPolicyCondition,
  ToolPoliciesConfig,
  ToolPolicyMetadataPredicate,
  ToolPolicyOverride,
  ToolPolicyRule,
} from '../config/types';
import { ToolRegistryService } from '../tool/service';
import type { Tool } from '../tool/tool';
import { ToolGateToolNotFoundError } from './errors';
import type {
  ToolGateCandidateTool,
  ToolGateContext,
  ToolGateDecision,
  ToolGateFilterResult,
  ToolGateRuleEvaluation,
  ToolGateScopedRule,
  ToolGateServiceApi,
} from './types';

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isMetadataPredicate = (value: unknown): value is ToolPolicyMetadataPredicate =>
  typeof value === 'object' &&
  value !== null &&
  (hasOwn(value as Record<string, unknown>, 'equals') ||
    hasOwn(value as Record<string, unknown>, 'notEquals') ||
    hasOwn(value as Record<string, unknown>, 'in') ||
    hasOwn(value as Record<string, unknown>, 'notIn') ||
    hasOwn(value as Record<string, unknown>, 'exists'));

const asArray = (value: string | string[] | undefined): string[] | undefined => {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
};

const matchesScalarCondition = (candidate: string | undefined, accepted: string | string[] | undefined): boolean => {
  const acceptedValues = asArray(accepted);
  if (!acceptedValues || acceptedValues.length === 0) {
    return true;
  }
  return candidate !== undefined && acceptedValues.includes(candidate);
};

const valueMatchesPredicate = (value: unknown, predicate: ToolPolicyMetadataPredicate): boolean => {
  if (predicate.exists !== undefined) {
    const exists = value !== undefined;
    if (exists !== predicate.exists) {
      return false;
    }
  }

  if (predicate.equals !== undefined && value !== predicate.equals) {
    return false;
  }

  if (predicate.notEquals !== undefined && value === predicate.notEquals) {
    return false;
  }

  if (predicate.in && !predicate.in.includes(value)) {
    return false;
  }

  if (predicate.notIn && predicate.notIn.includes(value)) {
    return false;
  }

  return true;
};

const matchesMetadataCondition = (
  metadata: Record<string, unknown> | undefined,
  condition: Record<string, unknown | ToolPolicyMetadataPredicate> | undefined
): boolean => {
  if (!condition) {
    return true;
  }

  const target = metadata ?? {};

  for (const [key, expected] of Object.entries(condition)) {
    const actual = target[key];

    if (isMetadataPredicate(expected)) {
      if (!valueMatchesPredicate(actual, expected)) {
        return false;
      }
      continue;
    }

    if (actual !== expected) {
      return false;
    }
  }

  return true;
};

const matchesConditions = (context: ToolGateContext, conditions: ToolPolicyCondition | undefined): boolean => {
  if (!conditions) {
    return true;
  }

  if (!matchesScalarCondition(context.role, conditions.role)) {
    return false;
  }

  if (!matchesScalarCondition(context.userId, conditions.userId)) {
    return false;
  }

  return matchesMetadataCondition(context.metadata, conditions.metadata);
};

const toolHasRequiredCategories = (tool: ToolGateCandidateTool, requiredCategories: string[] | undefined): boolean => {
  if (!requiredCategories || requiredCategories.length === 0) {
    return true;
  }

  const capabilities = new Set(tool.capabilities ?? []);
  return requiredCategories.every((required) => capabilities.has(required));
};

const cloneRule = (rule: ToolPolicyRule): ToolPolicyRule => ({
  allow: rule.allow ? [...rule.allow] : undefined,
  deny: rule.deny ? [...rule.deny] : undefined,
  requireApproval: rule.requireApproval ? [...rule.requireApproval] : undefined,
  requiredCategories: rule.requiredCategories ? [...rule.requiredCategories] : undefined,
  conflictResolution: rule.conflictResolution,
  conditions: rule.conditions
    ? {
        role: Array.isArray(rule.conditions.role) ? [...rule.conditions.role] : rule.conditions.role,
        userId: Array.isArray(rule.conditions.userId) ? [...rule.conditions.userId] : rule.conditions.userId,
        metadata: rule.conditions.metadata ? { ...rule.conditions.metadata } : undefined,
      }
    : undefined,
});

const clonePolicies = (policies: ToolPoliciesConfig | undefined): ToolPoliciesConfig | undefined => {
  if (!policies) {
    return undefined;
  }

  return {
    default: policies.default ? cloneRule(policies.default) : undefined,
    intents: policies.intents
      ? Object.fromEntries(Object.entries(policies.intents).map(([id, rule]) => [id, cloneRule(rule)]))
      : undefined,
    agents: policies.agents
      ? Object.fromEntries(Object.entries(policies.agents).map(([id, rule]) => [id, cloneRule(rule)]))
      : undefined,
    overrides: policies.overrides?.map((override) => ({
      ...cloneRule(override),
      id: override.id,
      override: true,
      target: {
        intentId: override.target.intentId,
        agentId: override.target.agentId,
      },
    })),
  };
};

const matchesOverrideTarget = (context: ToolGateContext, override: ToolPolicyOverride): boolean => {
  const intentMatch = !override.target.intentId || override.target.intentId === context.intentId;
  const agentMatch = !override.target.agentId || override.target.agentId === context.agentId;
  return intentMatch && agentMatch;
};

const collectScopedRules = (policies: ToolPoliciesConfig | undefined, context: ToolGateContext): ToolGateScopedRule[] => {
  if (!policies) {
    return [];
  }

  const inherited: ToolGateScopedRule[] = [];

  if (policies.default && matchesConditions(context, policies.default.conditions)) {
    inherited.push({ scope: 'default', source: 'default', rule: policies.default });
  }

  if (context.intentId) {
    const intentRule = policies.intents?.[context.intentId];
    if (intentRule && matchesConditions(context, intentRule.conditions)) {
      inherited.push({ scope: 'intent', source: context.intentId, rule: intentRule });
    }
  }

  if (context.agentId) {
    const agentRule = policies.agents?.[context.agentId];
    if (agentRule && matchesConditions(context, agentRule.conditions)) {
      inherited.push({ scope: 'agent', source: context.agentId, rule: agentRule });
    }
  }

  const matchedOverrides = (policies.overrides ?? [])
    .filter((override) => matchesOverrideTarget(context, override) && matchesConditions(context, override.conditions))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((override) => ({
      scope: 'override' as const,
      source: override.id,
      rule: override,
    }));

  if (matchedOverrides.length > 0) {
    return matchedOverrides;
  }

  return inherited;
};

const collectRuleEvaluations = (tool: ToolGateCandidateTool, rules: ToolGateScopedRule[]): ToolGateRuleEvaluation[] => {
  const evaluations: ToolGateRuleEvaluation[] = [];

  for (const scopedRule of rules) {
    const { rule } = scopedRule;

    if (!toolHasRequiredCategories(tool, rule.requiredCategories)) {
      evaluations.push({
        scope: scopedRule.scope,
        source: scopedRule.source,
        effect: 'deny',
        reason: `missing-required-categories:${(rule.requiredCategories ?? []).join(',')}`,
      });
      continue;
    }

    if (rule.deny?.includes(tool.id)) {
      evaluations.push({
        scope: scopedRule.scope,
        source: scopedRule.source,
        effect: 'deny',
      });
      continue;
    }

    if (rule.allow?.includes(tool.id)) {
      evaluations.push({
        scope: scopedRule.scope,
        source: scopedRule.source,
        effect: 'allow',
      });
    }

    if (rule.requireApproval?.includes(tool.id)) {
      evaluations.push({
        scope: scopedRule.scope,
        source: scopedRule.source,
        effect: 'requireApproval',
      });
    }
  }

  return evaluations;
};

class ToolGateServiceImpl implements ToolGateServiceApi {
  constructor(
    private readonly policiesRef: Ref.Ref<ToolPoliciesConfig | undefined>,
    private readonly toolRegistry: ToolRegistryService
  ) {}

  evaluateTool(tool: ToolGateCandidateTool, context: ToolGateContext): Effect.Effect<ToolGateDecision> {
    const self = this;
    return Effect.gen(function* () {
      const policies = yield* Ref.get(self.policiesRef);
      const scopedRules = collectScopedRules(policies, context);
      const matchedRules = collectRuleEvaluations(tool, scopedRules);

      const deniedBy = matchedRules.find((rule) => rule.effect === 'deny');
      const hasAllow = matchedRules.some((rule) => rule.effect === 'allow');
      const requireApproval = matchedRules.some((rule) => rule.effect === 'requireApproval');

      return {
        toolId: tool.id,
        allowed: !deniedBy && (hasAllow || requireApproval),
        requireApproval,
        deniedBy,
        matchedRules,
      };
    });
  }

  evaluateToolById(toolId: string, context: ToolGateContext): Effect.Effect<ToolGateDecision, ToolGateToolNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const tool = yield* self.toolRegistry.getTool(toolId).pipe(
        Effect.mapError(() => new ToolGateToolNotFoundError({ toolId }))
      );

      return yield* self.evaluateTool({
        id: tool.id,
        capabilities: tool.capabilities,
      }, context);
    });
  }

  filterTools(tools: Tool[], context: ToolGateContext): Effect.Effect<ToolGateFilterResult> {
    const self = this;
    return Effect.gen(function* () {
      const decisions: ToolGateDecision[] = [];
      const allowed: Tool[] = [];

      for (const tool of tools) {
        const decision = yield* self.evaluateTool(
          {
            id: tool.id,
            capabilities: tool.capabilities,
          },
          context
        );
        decisions.push(decision);

        if (decision.allowed) {
          allowed.push(tool);
        }
      }

      return {
        allowed,
        denied: decisions.filter((decision) => !decision.allowed),
      };
    });
  }

  getAllowedTools(context: ToolGateContext, toolIds?: string[]): Effect.Effect<Tool[]> {
    const self = this;
    return Effect.gen(function* () {
      const tools = toolIds
        ? yield* self.toolRegistry.getTools(toolIds)
        : yield* self.toolRegistry.getAllTools();

      const filtered = yield* self.filterTools(tools, context);
      return filtered.allowed;
    });
  }

  setPolicies(policies: ToolPoliciesConfig | undefined): Effect.Effect<void> {
    return Ref.set(this.policiesRef, clonePolicies(policies));
  }

  reloadPolicies(policies: ToolPoliciesConfig | undefined): Effect.Effect<void> {
    return this.setPolicies(policies);
  }

  getPolicies(): Effect.Effect<ToolPoliciesConfig | undefined> {
    return Ref.get(this.policiesRef).pipe(Effect.map((policies) => clonePolicies(policies)));
  }
}

export const ToolGateService = Context.GenericTag<ToolGateServiceApi>('ToolGateService');

export const ToolGateServiceLive = Layer.effect(
  ToolGateService,
  Effect.gen(function* () {
    const toolRegistry = yield* ToolRegistryService;
    const policiesRef = yield* Ref.make<ToolPoliciesConfig | undefined>(undefined);
    return new ToolGateServiceImpl(policiesRef, toolRegistry);
  })
);
