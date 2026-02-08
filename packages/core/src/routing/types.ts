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

  /** Routing explanation with confidence and alternatives */
  explanation?: RoutingExplanation;

  /** HITL clarification request (present when low confidence or ambiguous routing) */
  clarificationNeeded?: import('../pipeline/pause/types').PauseSignal;
}

/**
 * Routing alternative candidate with confidence score.
 * Represents a possible routing target that was considered.
 */
export interface RoutingAlternative {
  /** Agent or intent identifier */
  targetId: string;

  /** Agent or intent display name */
  targetName: string;

  /** Calibrated confidence score (0.0-1.0) */
  confidence: number;

  /** How the match was made */
  matchType?: MatchType;

  /** Projected handoff path if applicable (e.g., ["calculator", "advanced-math"]) */
  handoffChain?: string[];
}

/**
 * Calibration metadata for debugging confidence scores.
 * Provides transparency into how raw scores were transformed.
 */
export interface CalibrationMetadata {
  /** Original uncalibrated score */
  rawScore: number;

  /** Score after temperature scaling */
  calibratedScore: number;

  /** Per-intent historical accuracy (0.0-1.0) */
  historicalAccuracy?: number;

  /** Adjustment from conversation context (-0.15 to +0.15) */
  conversationBoost?: number;

  /** Current calibration temperature parameter */
  temperature?: number;

  /** Whether enough observations exist for meaningful calibration */
  calibrated: boolean;

  /** Number of observations used for calibration */
  observationCount?: number;
}

/**
 * Routing concern detected during decision process.
 * Indicates potential issues that may require attention.
 */
export interface RoutingConcern {
  /** Type of concern */
  type: 'low-confidence' | 'close-alternatives' | 'classification-conflict';

  /** Severity level */
  severity: 'warning' | 'error';

  /** Human-readable description */
  message: string;
}

/**
 * Complete routing explanation with alternatives and confidence.
 * Provides transparency into routing decision process.
 */
export interface RoutingExplanation {
  /** The selected route */
  winner: RoutingAlternative;

  /** Top 3 runner-ups, sorted by confidence descending (never includes zero-confidence items) */
  alternatives: RoutingAlternative[];

  /** Final calibrated confidence of winner */
  confidence: number;

  /** How the winning match was made */
  matchType: MatchType;

  /** Debugging metadata */
  calibrationMetadata: CalibrationMetadata;

  /** Detected concerns (empty array if none) */
  concerns: RoutingConcern[];

  /** Human-readable explanation text */
  narrative: string;
}
