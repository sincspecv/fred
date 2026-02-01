import { AgentResponse } from '../agent/agent';

/**
 * Golden trace format version
 * Increment this for breaking changes
 */
export const GOLDEN_TRACE_VERSION = '1.0';

/**
 * Span data in golden trace format
 */
export interface GoldenTraceSpan {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    time: number;
    attributes?: Record<string, any>;
  }>;
  status: {
    code: 'ok' | 'error' | 'unset';
    message?: string;
  };
  kind?: string;
}

/**
 * Tool call data in golden trace format
 */
export interface GoldenTraceToolCall {
  toolId: string;
  args: Record<string, any>;
  result?: any;
  timing: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  status: 'success' | 'error';
  error?: string;
}

/**
 * Handoff data in golden trace format
 */
export interface GoldenTraceHandoff {
  fromAgent?: string;
  toAgent: string;
  message: string;
  context?: Record<string, any>;
  timing: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  depth: number;
}

/**
 * Trace data structure
 */
export interface GoldenTraceData {
  message: string;
  spans: GoldenTraceSpan[];
  response: AgentResponse;
  toolCalls: GoldenTraceToolCall[];
  handoffs: GoldenTraceHandoff[];
  routing: {
    method: 'agent.utterance' | 'intent.matching' | 'default.agent';
    agentId?: string;
    intentId?: string;
    confidence?: number;
    matchType?: 'exact' | 'regex' | 'semantic';
  };
}

/**
 * Metadata for golden trace
 */
export interface GoldenTraceMetadata {
  timestamp: number;
  fredVersion: string;
  config?: {
    useSemanticMatching?: boolean;
    semanticThreshold?: number;
    conversationId?: string;
  };
  environment?: {
    nodeVersion?: string;
    platform?: string;
  };
}

/**
 * Complete golden trace structure
 */
export interface GoldenTrace {
  version: string;
  metadata: GoldenTraceMetadata;
  trace: GoldenTraceData;
}

/**
 * Validate golden trace structure
 */
export function validateGoldenTrace(trace: any): trace is GoldenTrace {
  if (!trace || typeof trace !== 'object') {
    return false;
  }

  if (typeof trace.version !== 'string') {
    return false;
  }

  if (!trace.metadata || typeof trace.metadata !== 'object') {
    return false;
  }

  if (typeof trace.metadata.timestamp !== 'number') {
    return false;
  }

  if (typeof trace.metadata.fredVersion !== 'string') {
    return false;
  }

  if (!trace.trace || typeof trace.trace !== 'object') {
    return false;
  }

  if (typeof trace.trace.message !== 'string') {
    return false;
  }

  if (!Array.isArray(trace.trace.spans)) {
    return false;
  }

  if (!trace.trace.response || typeof trace.trace.response !== 'object') {
    return false;
  }

  if (!Array.isArray(trace.trace.toolCalls)) {
    return false;
  }

  if (!Array.isArray(trace.trace.handoffs)) {
    return false;
  }

  return true;
}

/**
 * Get version from golden trace filename
 * Expected format: trace-v1.0.0-{hash}.json
 */
export function parseGoldenTraceVersion(filename: string): string | null {
  const match = filename.match(/trace-v(\d+\.\d+\.\d+)-/);
  return match ? match[1] : null;
}

/**
 * Generate golden trace filename
 */
export function generateGoldenTraceFilename(version: string, hash?: string): string {
  const hashSuffix = hash ? `-${hash}` : '';
  return `trace-v${version}${hashSuffix}.json`;
}
