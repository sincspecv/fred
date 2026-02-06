import type { AgentInstance, AgentMessage, AgentResponse } from '../agent/agent';
import type { AgentManager } from '../agent/manager';
import type { ContextManager } from '../context/manager';
import type { IntentMatcher } from '../intent/matcher';
import type { IntentRouter } from '../intent/router';
import type { PipelineManager } from '../pipeline/manager';
import type { MessageRouter } from '../routing/router';
import type { Tracer } from '../tracing';
import type { HookManager } from '../hooks/manager';
import type { ObservabilityService } from '../observability/service';

/**
 * ToolFailure record type for persistence (distinct from ToolResult).
 * Per locked decision: Tool failures are persisted as separate records, not via isFailure flag.
 * This enables accurate history reconstruction and differentiation from success records.
 */
export interface ToolFailureRecord {
  /** Discriminator for ToolFailure records in persisted result */
  __type: 'ToolFailure';
  /** Error details with code and message */
  error: {
    code: string;
    message: string;
  };
  /** Original output (typically error message string) */
  output: unknown;
}

/**
 * Type guard to check if a persisted tool result is a ToolFailure record
 */
export function isToolFailureRecord(result: unknown): result is ToolFailureRecord {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as ToolFailureRecord).__type === 'ToolFailure' &&
    typeof (result as ToolFailureRecord).error === 'object'
  );
}

/**
 * Result of routing a message to a handler
 */
export interface RouteResult {
  type: 'agent' | 'pipeline' | 'intent' | 'default' | 'none';
  agent?: AgentInstance;
  agentId?: string;
  pipelineId?: string;
  response?: AgentResponse;
}

/**
 * Options for processing messages
 */
export interface ProcessingOptions {
  useSemanticMatching?: boolean;
  semanticThreshold?: number;
  conversationId?: string;
  requireConversationId?: boolean;
  sequentialVisibility?: boolean;
}

/**
 * Memory/conversation defaults
 */
export interface MemoryDefaults {
  policy?: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  };
  requireConversationId?: boolean;
  sequentialVisibility?: boolean;
}

/**
 * Dependencies required by MessageProcessor
 */
export interface MessageProcessorDeps {
  contextManager: ContextManager;
  agentManager: AgentManager;
  pipelineManager: PipelineManager;
  intentMatcher: IntentMatcher;
  intentRouter: IntentRouter;
  tracer?: Tracer;
  messageRouter?: MessageRouter;
  memoryDefaults: MemoryDefaults;
  defaultAgentId?: string;
  hookManager?: HookManager;
  observabilityService?: ObservabilityService;
}

/**
 * Semantic matcher function type
 * Matches the signature expected by AgentService and PipelineService
 */
export type SemanticMatcherFn = (
  msg: string,
  utterances: string[]
) => Promise<{ matched: boolean; confidence: number; utterance?: string }>;
