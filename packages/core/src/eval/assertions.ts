import { GoldenTrace, GoldenTraceSpan, GoldenTraceToolCall, GoldenTraceHandoff } from './golden-trace';

/**
 * Assertion result
 */
export interface AssertionResult {
  passed: boolean;
  message: string;
  details?: any;
}

/**
 * Assert that a tool was called
 */
export function assertToolCalled(
  trace: GoldenTrace,
  toolId: string,
  expectedArgs?: Record<string, any>
): AssertionResult {
  const toolCall = trace.trace.toolCalls.find(tc => tc.toolId === toolId);
  
  if (!toolCall) {
    return {
      passed: false,
      message: `Expected tool "${toolId}" to be called, but it was not`,
    };
  }

  if (expectedArgs) {
    // Check if args match (deep equality)
    const argsMatch = JSON.stringify(toolCall.args) === JSON.stringify(expectedArgs);
    if (!argsMatch) {
      return {
        passed: false,
        message: `Tool "${toolId}" was called with different arguments than expected`,
        details: {
          expected: expectedArgs,
          actual: toolCall.args,
        },
      };
    }
  }

  return {
    passed: true,
    message: `Tool "${toolId}" was called successfully`,
    details: {
      args: toolCall.args,
      result: toolCall.result,
      timing: toolCall.timing,
    },
  };
}

/**
 * Assert that a specific agent was selected
 */
export function assertAgentSelected(
  trace: GoldenTrace,
  agentId: string
): AssertionResult {
  const routing = trace.trace.routing;
  
  if (routing.method === 'agent.utterance' && routing.agentId === agentId) {
    return {
      passed: true,
      message: `Agent "${agentId}" was selected via agent utterance`,
      details: {
        method: routing.method,
        confidence: routing.confidence,
        matchType: routing.matchType,
      },
    };
  }

  if (routing.method === 'intent.matching' && routing.agentId === agentId) {
    return {
      passed: true,
      message: `Agent "${agentId}" was selected via intent matching`,
      details: {
        method: routing.method,
        intentId: routing.intentId,
      },
    };
  }

  if (routing.method === 'default.agent' && routing.agentId === agentId) {
    return {
      passed: true,
      message: `Agent "${agentId}" was selected as default agent`,
      details: {
        method: routing.method,
      },
    };
  }

  return {
    passed: false,
    message: `Expected agent "${agentId}" to be selected, but got "${routing.agentId || 'none'}"`,
    details: {
      actualRouting: routing,
    },
  };
}

/**
 * Assert that a handoff occurred
 */
export function assertHandoff(
  trace: GoldenTrace,
  fromAgent?: string,
  toAgent?: string
): AssertionResult {
  const handoffs = trace.trace.handoffs;
  
  if (handoffs.length === 0) {
    return {
      passed: false,
      message: 'Expected a handoff to occur, but none were found',
    };
  }

  if (toAgent) {
    const matchingHandoff = handoffs.find(h => h.toAgent === toAgent);
    if (!matchingHandoff) {
      return {
        passed: false,
        message: `Expected handoff to agent "${toAgent}", but it was not found`,
        details: {
          actualHandoffs: handoffs.map(h => ({ from: h.fromAgent, to: h.toAgent })),
        },
      };
    }

    if (fromAgent && matchingHandoff.fromAgent !== fromAgent) {
      return {
        passed: false,
        message: `Expected handoff from "${fromAgent}" to "${toAgent}", but got from "${matchingHandoff.fromAgent}"`,
        details: {
          actualHandoff: matchingHandoff,
        },
      };
    }

    return {
      passed: true,
      message: `Handoff from "${matchingHandoff.fromAgent || 'unknown'}" to "${toAgent}" occurred`,
      details: {
        handoff: matchingHandoff,
      },
    };
  }

  return {
    passed: true,
    message: `Found ${handoffs.length} handoff(s)`,
    details: {
      handoffs,
    },
  };
}

/**
 * Assert that the response contains specific text
 */
export function assertResponseContains(
  trace: GoldenTrace,
  text: string,
  caseSensitive: boolean = false
): AssertionResult {
  const responseContent = trace.trace.response.content;
  const searchText = caseSensitive ? text : text.toLowerCase();
  const responseText = caseSensitive ? responseContent : responseContent.toLowerCase();

  if (responseText.includes(searchText)) {
    return {
      passed: true,
      message: `Response contains "${text}"`,
    };
  }

  return {
    passed: false,
    message: `Expected response to contain "${text}", but it did not`,
    details: {
      responsePreview: responseContent.substring(0, 200),
    },
  };
}

/**
 * Assert that a span exists with specific attributes
 */
export function assertSpan(
  trace: GoldenTrace,
  spanName: string,
  expectedAttributes?: Record<string, any>
): AssertionResult {
  const span = trace.trace.spans.find(s => s.name === spanName);
  
  if (!span) {
    return {
      passed: false,
      message: `Expected span "${spanName}" to exist, but it was not found`,
      details: {
        availableSpans: trace.trace.spans.map(s => s.name),
      },
    };
  }

  if (expectedAttributes) {
    const missingAttributes: string[] = [];
    const mismatchedAttributes: Array<{ key: string; expected: any; actual: any }> = [];

    for (const [key, expectedValue] of Object.entries(expectedAttributes)) {
      if (!(key in span.attributes)) {
        missingAttributes.push(key);
      } else if (JSON.stringify(span.attributes[key]) !== JSON.stringify(expectedValue)) {
        mismatchedAttributes.push({
          key,
          expected: expectedValue,
          actual: span.attributes[key],
        });
      }
    }

    if (missingAttributes.length > 0 || mismatchedAttributes.length > 0) {
      return {
        passed: false,
        message: `Span "${spanName}" does not match expected attributes`,
        details: {
          missingAttributes,
          mismatchedAttributes,
          actualAttributes: span.attributes,
        },
      };
    }
  }

  return {
    passed: true,
    message: `Span "${spanName}" exists with expected attributes`,
    details: {
      span,
    },
  };
}

/**
 * Assert timing constraints
 */
export function assertTiming(
  trace: GoldenTrace,
  spanName: string,
  maxDuration: number
): AssertionResult {
  const span = trace.trace.spans.find(s => s.name === spanName);
  
  if (!span) {
    return {
      passed: false,
      message: `Cannot assert timing for span "${spanName}" - span not found`,
    };
  }

  if (span.duration > maxDuration) {
    return {
      passed: false,
      message: `Span "${spanName}" took ${span.duration}ms, which exceeds maximum of ${maxDuration}ms`,
      details: {
        actualDuration: span.duration,
        maxDuration,
        startTime: span.startTime,
        endTime: span.endTime,
      },
    };
  }

  return {
    passed: true,
    message: `Span "${spanName}" completed within ${maxDuration}ms (took ${span.duration}ms)`,
    details: {
      duration: span.duration,
      maxDuration,
    },
  };
}

/**
 * Assert schema validity
 */
export function assertSchema(trace: GoldenTrace): AssertionResult {
  // Basic schema validation
  if (!trace.version) {
    return {
      passed: false,
      message: 'Trace missing version field',
    };
  }

  if (!trace.metadata) {
    return {
      passed: false,
      message: 'Trace missing metadata field',
    };
  }

  if (!trace.trace) {
    return {
      passed: false,
      message: 'Trace missing trace data field',
    };
  }

  if (!trace.trace.message) {
    return {
      passed: false,
      message: 'Trace missing message field',
    };
  }

  if (!Array.isArray(trace.trace.spans)) {
    return {
      passed: false,
      message: 'Trace spans field is not an array',
    };
  }

  if (!trace.trace.response) {
    return {
      passed: false,
      message: 'Trace missing response field',
    };
  }

  if (!Array.isArray(trace.trace.toolCalls)) {
    return {
      passed: false,
      message: 'Trace toolCalls field is not an array',
    };
  }

  if (!Array.isArray(trace.trace.handoffs)) {
    return {
      passed: false,
      message: 'Trace handoffs field is not an array',
    };
  }

  return {
    passed: true,
    message: 'Trace schema is valid',
  };
}
