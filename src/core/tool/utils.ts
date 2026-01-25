import { Tool } from './tool';
import { wrapToolExecution } from './validation';

export function normalizeToolDefinition(
  toolDef: Tool,
  executeFn: (args: Record<string, any>) => Promise<any> | any
): Tool {
  const validatedExecute = wrapToolExecution(toolDef, executeFn);

  return {
    ...toolDef,
    execute: validatedExecute,
  };
}
