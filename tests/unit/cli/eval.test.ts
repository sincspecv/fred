import { describe, expect, test } from 'bun:test';
import { handleEvalCommand } from '../../../packages/cli/src/eval';

describe('cli eval command', () => {
  test('returns usage error when subcommand is missing', async () => {
    const stderr: string[] = [];

    const exitCode = await handleEvalCommand([], {}, {
      service: {
        record: async () => ({}),
        replay: async () => ({}),
        compare: async () => ({
          passed: true,
          scorecard: {
            totalChecks: 1,
            passedChecks: 1,
            failedChecks: 0,
            regressions: [],
          },
        }),
        suite: async () => ({}),
      },
      io: {
        stdout: () => {
          return;
        },
        stderr: (message) => {
          stderr.push(message);
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain('Missing eval subcommand');
  });
});
