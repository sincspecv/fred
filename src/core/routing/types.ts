/**
 * Routing types for rule-based message routing
 *
 * Supports config-based patterns (regex, keywords), function matchers,
 * and metadata filtering with specificity-based priority.
 */

/**
 * Function matcher signature for custom routing logic.
 * Can be synchronous or asynchronous.
 */
export type RuleMatcher = (
  message: string,
  metadata: Record<string, unknown>
) => boolean | Promise<boolean>;

/**
 * Routing rule definition.
 *
 * Rules can match on:
 * - patterns: Regex patterns (matched in order, case-insensitive)
 * - keywords: Word-boundary keywords (case-insensitive)
 * - metadata: Exact metadata filters (case-sensitive)
 * - matcher: Custom function matcher
 *
 * Most specific matching rule wins when multiple rules match.
 */
export interface RoutingRule {
  /** Unique rule identifier */
  id: string;

  /** Target agent ID to route to */
  agent: string;

  /** Regex patterns to match (checked in order, case-insensitive) */
  patterns?: string[];

  /** Keywords to match with word boundaries (case-insensitive) */
  keywords?: string[];

  /** Metadata filters - all must match exactly (case-sensitive) */
  metadata?: Record<string, unknown>;

  /** Custom function matcher for complex logic */
  matcher?: RuleMatcher;

  /** Optional explicit priority (higher = checked first) */
  priority?: number;
}

/**
 * Routing configuration.
 */
export interface RoutingConfig {
  /** Fallback agent when no rule matches */
  defaultAgent: string;

  /** Routing rules (checked in specificity order) */
  rules: RoutingRule[];

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Match type for specificity calculation.
 * Order by specificity: exact > regex > keyword > function > metadata-only
 */
export type MatchType = 'exact' | 'regex' | 'keyword' | 'function' | 'metadata-only';

/**
 * Route match result from matching a single rule.
 */
export interface RouteMatch {
  /** The matched rule */
  rule: RoutingRule;

  /** How the match was made */
  matchType: MatchType;

  /** Match confidence (0-1) */
  confidence: number;

  /** Specificity score for priority ranking */
  specificity: number;

  /** The pattern/keyword that matched (if applicable) */
  matchedPattern?: string;
}

/**
 * Final routing decision result.
 */
export interface RoutingDecision {
  /** Selected agent ID */
  agent: string;

  /** The matched rule (undefined if fallback) */
  rule?: RoutingRule;

  /** How the match was made */
  matchType?: MatchType;

  /** True if no rule matched (using default agent) */
  fallback: boolean;

  /** Specificity score of winning rule */
  specificity?: number;
}
