import { Data } from 'effect';

export class ToolGateToolNotFoundError extends Data.TaggedError('ToolGateToolNotFoundError')<{
  toolId: string;
}> {}
