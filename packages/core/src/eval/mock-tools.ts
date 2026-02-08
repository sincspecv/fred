import type { Tool } from '../tool/tool';
import type { EvalToolCallArtifact, EvaluationArtifact } from './artifact';
import { toDeterministicValue } from './artifact';

export class MissingToolMockResponseError extends Error {
  constructor(toolId: string, callOrdinal: number) {
    super(
      `Replay mock missing recorded response for tool "${toolId}" call #${callOrdinal}. ` +
        'Replay requires recorded mock responses for every expected tool call.'
    );
    this.name = 'MissingToolMockResponseError';
  }
}

export class ToolMockSignatureMismatchError extends Error {
  constructor(toolId: string, callOrdinal: number) {
    super(
      `Replay tool call signature mismatch for "${toolId}" call #${callOrdinal}. ` +
        'Recorded arguments do not match replay invocation.'
    );
    this.name = 'ToolMockSignatureMismatchError';
  }
}

interface ToolQueueState {
  index: number;
  calls: EvalToolCallArtifact[];
}

export interface ReplayToolMocks {
  readonly toolExecutors: Map<string, Tool['execute']>;
  assertConsumed: () => void;
}

function deterministicJson(value: unknown): string {
  return JSON.stringify(toDeterministicValue(value));
}

function assertMockResponsesExist(toolCalls: ReadonlyArray<EvalToolCallArtifact>): void {
  for (const call of toolCalls) {
    if (call.status === 'success' && call.result === undefined) {
      throw new MissingToolMockResponseError(call.toolId, call.callOrdinal);
    }
  }
}

export function buildReplayToolMocks(artifact: EvaluationArtifact): ReplayToolMocks {
  assertMockResponsesExist(artifact.toolCalls);

  const byTool = new Map<string, ToolQueueState>();
  for (const call of artifact.toolCalls) {
    const current = byTool.get(call.toolId);
    if (current) {
      current.calls.push(call);
    } else {
      byTool.set(call.toolId, { index: 0, calls: [call] });
    }
  }

  const toolExecutors = new Map<string, Tool['execute']>();

  for (const [toolId, queue] of byTool.entries()) {
    toolExecutors.set(toolId, async (args: unknown) => {
      const call = queue.calls[queue.index];
      if (!call) {
        throw new MissingToolMockResponseError(toolId, queue.index);
      }

      if (call.args !== undefined) {
        const expectedSignature = deterministicJson(call.args);
        const actualSignature = deterministicJson(args);
        if (expectedSignature !== actualSignature) {
          throw new ToolMockSignatureMismatchError(toolId, call.callOrdinal);
        }
      }

      queue.index += 1;

      if (call.status === 'error') {
        throw new Error(call.error ?? `Recorded replay tool failure for "${toolId}".`);
      }

      if (call.result === undefined) {
        throw new MissingToolMockResponseError(toolId, call.callOrdinal);
      }

      return toDeterministicValue(call.result);
    });
  }

  return {
    toolExecutors,
    assertConsumed: () => {
      for (const [toolId, queue] of byTool.entries()) {
        if (queue.index !== queue.calls.length) {
          throw new Error(
            `Replay did not consume all recorded mocks for tool "${toolId}". ` +
              `Consumed ${queue.index}/${queue.calls.length}.`
          );
        }
      }
    },
  };
}
