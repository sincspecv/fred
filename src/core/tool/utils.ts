import type { Tool } from './tool';
import { wrapToolExecution } from './validation';

export function normalizeToolDefinition<Input = unknown, Output = unknown>(
  toolDef: Tool<Input, Output, unknown>,
  executeFn: (args: Input) => Promise<Output> | Output
): Tool<Input, Output, unknown> {
  const validatedExecute = wrapToolExecution(toolDef, executeFn);

  return {
    ...toolDef,
    execute: validatedExecute as (args: Input) => Promise<Output> | Output,
  };
}
