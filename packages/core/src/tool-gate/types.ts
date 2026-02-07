import type { ToolPoliciesConfig, ToolPolicyRule } from '../config/types';
import type { Tool, ToolCapability } from '../tool/tool';
import type { Effect } from 'effect';

export type ToolGateScope = 'default' | 'intent' | 'agent' | 'override';

export interface ToolGateContext {
  intentId?: string;
  agentId?: string;
  userId?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolGateRuleEvaluation {
  scope: ToolGateScope;
  source: string;
  effect: 'allow' | 'deny' | 'requireApproval';
  reason?: string;
}

export interface ToolGateDecision {
  toolId: string;
  allowed: boolean;
  requireApproval: boolean;
  matchedRules: ToolGateRuleEvaluation[];
  deniedBy?: ToolGateRuleEvaluation;
}

export interface ToolGateFilterResult {
  allowed: Tool[];
  denied: ToolGateDecision[];
}

export interface ToolGateCandidateTool {
  id: string;
  capabilities?: ToolCapability[];
}

export interface ToolGateScopedRule {
  scope: ToolGateScope;
  source: string;
  rule: ToolPolicyRule;
}

export interface ToolGateServiceApi {
  evaluateTool(
    tool: ToolGateCandidateTool,
    context: ToolGateContext
  ): Effect.Effect<ToolGateDecision>;

  evaluateToolById(
    toolId: string,
    context: ToolGateContext
  ): Effect.Effect<ToolGateDecision, import('./errors').ToolGateToolNotFoundError>;

  filterTools(
    tools: Tool[],
    context: ToolGateContext
  ): Effect.Effect<ToolGateFilterResult>;

  getAllowedTools(
    context: ToolGateContext,
    toolIds?: string[]
  ): Effect.Effect<Tool[]>;

  setPolicies(policies: ToolPoliciesConfig | undefined): Effect.Effect<void>;

  reloadPolicies(policies: ToolPoliciesConfig | undefined): Effect.Effect<void>;

  getPolicies(): Effect.Effect<ToolPoliciesConfig | undefined>;
}
