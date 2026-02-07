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

export interface PolicyAuditEvent {
  toolId: string;
  outcome: 'allow' | 'deny' | 'requireApproval';
  intentId?: string;
  agentId?: string;
  userId?: string;
  role?: string;
  matchedRules: ToolGateRuleEvaluation[];
  deniedBy?: ToolGateRuleEvaluation;
  argsHash?: string;
  timestamp: string;
}

export interface ToolApprovalRequest {
  toolId: string;
  intentId?: string;
  agentId?: string;
  userId?: string;
  reason: string;
  /** Session key for scoping approval persistence */
  sessionKey: string;
  /** TTL for approval request (default: 300000ms = 5 minutes) */
  ttlMs?: number;
}

export interface ToolApprovalRecord {
  toolId: string;
  sessionKey: string;
  approved: boolean;
  timestamp: string;
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

  /** Check if tool has a session-scoped approval already */
  hasApproval(toolId: string, sessionKey: string): Effect.Effect<boolean>;

  /** Record an approval or denial for a tool in a session */
  recordApproval(toolId: string, sessionKey: string, approved: boolean): Effect.Effect<void>;

  /** Clear all approvals (e.g., when session ends) */
  clearApprovals(sessionKey?: string): Effect.Effect<void>;

  /** Generate an approval request for a requireApproval decision */
  createApprovalRequest(decision: ToolGateDecision, context: ToolGateContext): Effect.Effect<ToolApprovalRequest | undefined>;
}
