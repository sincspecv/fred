/**
 * MessageRouter - Rule-based message routing with specificity ranking
 *
 * Routes messages to agents based on:
 * - Regex patterns (case-insensitive)
 * - Keywords with word boundaries (case-insensitive)
 * - Metadata filters (case-sensitive, exact match)
 * - Custom function matchers (sync or async)
 *
 * When multiple rules match, the most specific wins (highest specificity score).
 * Includes fallback cascade: default agent -> first registered agent -> error.
 */

import {
  RoutingConfig,
  RoutingRule,
  RouteMatch,
  RoutingDecision,
  MatchType,
} from './types';
import { AgentManager } from '../agent/manager';
import { HookManager } from '../hooks/manager';

/**
 * Specificity base scores by match type.
 * Higher = more specific.
 */
const MATCH_TYPE_SCORES: Record<MatchType, number> = {
  exact: 1000,
  regex: 800,
  keyword: 700,
  function: 600,
  'metadata-only': 500,
};

/**
 * MessageRouter routes messages to agents based on configurable rules.
 */
export class MessageRouter {
  private readonly config: RoutingConfig;
  private readonly agentManager: AgentManager;
  private readonly hookManager?: HookManager;

  constructor(
    agentManager: AgentManager,
    hookManager: HookManager | undefined,
    config: RoutingConfig
  ) {
    this.agentManager = agentManager;
    this.hookManager = hookManager;
    this.config = config;
  }

  /**
   * Route a message to an agent.
   * Emits beforeRouting and afterRouting hooks.
   *
   * @param message - The message to route
   * @param metadata - Message metadata for filtering
   * @returns Routing decision with selected agent
   */
  async route(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<RoutingDecision> {
    const startTime = Date.now();

    // Emit beforeRouting hook
    await this.hookManager?.executeHooks('beforeRouting', {
      type: 'beforeRouting',
      timestamp: startTime,
      data: { message, metadata },
    });

    const match = await this.findBestMatch(message, metadata);
    let decision: RoutingDecision;

    if (match) {
      decision = {
        agent: match.rule.agent,
        rule: match.rule,
        matchType: match.matchType,
        fallback: false,
        specificity: match.specificity,
      };
    } else {
      // No match - execute fallback cascade
      const fallbackAgent = this.getFallbackAgent();
      decision = {
        agent: fallbackAgent,
        fallback: true,
      };
    }

    const durationMs = Date.now() - startTime;

    // Debug logging
    if (this.config.debug) {
      this.logRoutingDecision(decision, match, durationMs);
    }

    // Emit afterRouting hook
    await this.hookManager?.executeHooks('afterRouting', {
      type: 'afterRouting',
      timestamp: Date.now(),
      data: {
        message,
        metadata,
        decision,
        durationMs,
      },
    });

    return decision;
  }

  /**
   * Test routing without side effects (dry run).
   * Does not emit hooks or log debug output.
   *
   * @param message - The message to test
   * @param metadata - Message metadata for filtering
   * @returns Routing decision (same as route())
   */
  async testRoute(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<RoutingDecision> {
    const match = await this.findBestMatch(message, metadata);

    if (match) {
      return {
        agent: match.rule.agent,
        rule: match.rule,
        matchType: match.matchType,
        fallback: false,
        specificity: match.specificity,
      };
    }

    // No match - execute fallback cascade (silently)
    const fallbackAgent = this.getFallbackAgentSilent();
    return {
      agent: fallbackAgent,
      fallback: true,
    };
  }

  /**
   * Get fallback agent using cascade logic.
   * Logs warnings when falling back.
   *
   * Cascade:
   * 1. Use config.defaultAgent if set and agent exists
   * 2. Use first registered agent (with warning)
   * 3. Throw error if no agents exist
   */
  getFallbackAgent(): string {
    // Try configured default agent
    if (this.config.defaultAgent) {
      if (this.agentManager.hasAgent(this.config.defaultAgent)) {
        return this.config.defaultAgent;
      }
      console.warn(
        `[Routing] Default agent "${this.config.defaultAgent}" not found, falling back to first registered agent`
      );
    }

    // Try first registered agent
    const allAgents = this.agentManager.getAllAgents();
    if (allAgents.length > 0) {
      const firstAgent = allAgents[0];
      console.warn(
        `[Routing] No default agent configured, using first registered agent: "${firstAgent.id}"`
      );
      return firstAgent.id;
    }

    // No agents available
    throw new Error(
      'No agents available for routing. Register at least one agent.'
    );
  }

  /**
   * Get fallback agent silently (for testRoute).
   * Same cascade logic but without logging.
   */
  private getFallbackAgentSilent(): string {
    // Try configured default agent
    if (this.config.defaultAgent) {
      if (this.agentManager.hasAgent(this.config.defaultAgent)) {
        return this.config.defaultAgent;
      }
    }

    // Try first registered agent
    const allAgents = this.agentManager.getAllAgents();
    if (allAgents.length > 0) {
      return allAgents[0].id;
    }

    // No agents available
    throw new Error(
      'No agents available for routing. Register at least one agent.'
    );
  }

  /**
   * Log routing decision (when debug=true).
   */
  private logRoutingDecision(
    decision: RoutingDecision,
    match: RouteMatch | null,
    durationMs: number
  ): void {
    const parts: string[] = [
      `[Routing]`,
      `agent="${decision.agent}"`,
      `fallback=${decision.fallback}`,
      `duration=${durationMs}ms`,
    ];

    if (match) {
      parts.push(`matchType="${match.matchType}"`);
      parts.push(`ruleId="${match.rule.id}"`);
      parts.push(`specificity=${match.specificity}`);
    }

    console.log(parts.join(' '));
  }

  /**
   * Find the best matching rule for a message.
   *
   * @param message - The message to match
   * @param metadata - Message metadata for filtering
   * @returns Best match or null if no rules match
   */
  async findBestMatch(
    message: string,
    metadata: Record<string, unknown>
  ): Promise<RouteMatch | null> {
    const matches: RouteMatch[] = [];

    // Sort rules by priority (higher first) before checking
    const sortedRules = [...this.config.rules].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    for (const rule of sortedRules) {
      const match = await this.matchRule(message, metadata, rule);
      if (match) {
        matches.push(match);
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Sort by specificity descending
    matches.sort((a, b) => b.specificity - a.specificity);

    return matches[0];
  }

  /**
   * Match a message against a single rule.
   *
   * @param message - The message to match
   * @param metadata - Message metadata for filtering
   * @param rule - The rule to match against
   * @returns Match result or null if no match
   */
  async matchRule(
    message: string,
    metadata: Record<string, unknown>,
    rule: RoutingRule
  ): Promise<RouteMatch | null> {
    // 1. Check metadata filters first (all must match)
    if (rule.metadata) {
      if (!this.matchMetadata(metadata, rule.metadata)) {
        return null;
      }
    }

    // 2. Check custom matcher function
    if (rule.matcher) {
      try {
        const result = await Promise.resolve(rule.matcher(message, metadata));
        if (result) {
          return {
            rule,
            matchType: 'function',
            confidence: 0.8,
            specificity: this.calculateSpecificity(rule, 'function'),
          };
        }
        // Function returned false - don't match this rule
        return null;
      } catch (error) {
        // Log warning and skip rule on matcher error
        if (this.config.debug) {
          console.warn(
            `[Routing] Matcher error for rule "${rule.id}":`,
            error
          );
        }
        return null;
      }
    }

    // 3. Check regex patterns (case-insensitive)
    if (rule.patterns && rule.patterns.length > 0) {
      for (const pattern of rule.patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(message)) {
            // Check for exact match (pattern with anchors)
            const isExact =
              pattern.startsWith('^') &&
              pattern.endsWith('$') &&
              regex.test(message);
            const matchType: MatchType = isExact ? 'exact' : 'regex';

            return {
              rule,
              matchType,
              confidence: isExact ? 1.0 : 0.8,
              specificity: this.calculateSpecificity(rule, matchType, pattern),
              matchedPattern: pattern,
            };
          }
        } catch {
          // Invalid regex - skip pattern
          if (this.config.debug) {
            console.warn(
              `[Routing] Invalid regex pattern "${pattern}" in rule "${rule.id}"`
            );
          }
        }
      }
    }

    // 4. Check keywords (word boundary matching, case-insensitive)
    if (rule.keywords && rule.keywords.length > 0) {
      for (const keyword of rule.keywords) {
        if (this.matchKeyword(message, keyword)) {
          return {
            rule,
            matchType: 'keyword',
            confidence: 0.7,
            specificity: this.calculateSpecificity(rule, 'keyword', keyword),
            matchedPattern: keyword,
          };
        }
      }
    }

    // 5. If only metadata was specified and it matched, this is a metadata-only match
    if (
      rule.metadata &&
      Object.keys(rule.metadata).length > 0 &&
      !rule.patterns &&
      !rule.keywords &&
      !rule.matcher
    ) {
      return {
        rule,
        matchType: 'metadata-only',
        confidence: 0.6,
        specificity: this.calculateSpecificity(rule, 'metadata-only'),
      };
    }

    return null;
  }

  /**
   * Calculate specificity score for a rule match.
   *
   * Specificity algorithm:
   * - Base score from match type (exact > regex > keyword > function > metadata-only)
   * - Add pattern/keyword length (longer = more specific)
   * - Add metadata constraint count * 100
   * - Add explicit priority if set
   *
   * @param rule - The matched rule
   * @param matchType - How the match was made
   * @param matchedPattern - The pattern/keyword that matched (if applicable)
   * @returns Specificity score
   */
  calculateSpecificity(
    rule: RoutingRule,
    matchType: MatchType,
    matchedPattern?: string
  ): number {
    let score = MATCH_TYPE_SCORES[matchType];

    // Add pattern/keyword length
    if (matchedPattern) {
      score += matchedPattern.length;
    }

    // Add metadata constraint count
    if (rule.metadata) {
      score += Object.keys(rule.metadata).length * 100;
    }

    // Add explicit priority
    if (rule.priority !== undefined) {
      score += rule.priority;
    }

    return score;
  }

  /**
   * Match a keyword with word boundaries.
   *
   * Uses \b word boundary assertions for whole-word matching.
   * This prevents 'help' from matching 'helpful'.
   *
   * @param message - The message to search
   * @param keyword - The keyword to find
   * @returns True if keyword found as whole word
   */
  matchKeyword(message: string, keyword: string): boolean {
    // Escape special regex characters in keyword
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Use \b for word boundaries (case-insensitive)
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');

    return regex.test(message);
  }

  /**
   * Match metadata filters.
   *
   * All required keys must exist and match exactly.
   * Matching is case-sensitive for string values.
   *
   * @param provided - The actual metadata
   * @param required - The metadata filters to match
   * @returns True if all filters match
   */
  matchMetadata(
    provided: Record<string, unknown>,
    required: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(required)) {
      if (provided[key] !== value) {
        return false;
      }
    }
    return true;
  }
}
