import { Context, Effect, Layer, Ref } from 'effect';
import type { Tool } from './tool';
import { ToolNotFoundError, ToolAlreadyExistsError, ToolValidationError } from './errors';
import { validateToolSchema } from './validation';
import { normalizeToolDefinition } from './utils';

/**
 * ToolRegistryService interface for Effect-based tool management
 */
export interface ToolRegistryService {
  /**
   * Register a tool in the registry
   */
  registerTool(tool: Tool): Effect.Effect<void, ToolAlreadyExistsError | ToolValidationError>;

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Tool[]): Effect.Effect<void, ToolAlreadyExistsError | ToolValidationError>;

  /**
   * Get a tool by ID
   */
  getTool(id: string): Effect.Effect<Tool, ToolNotFoundError>;

  /**
   * Get multiple tools by their IDs (returns only found tools)
   */
  getTools(ids: string[]): Effect.Effect<Tool[]>;

  /**
   * Get missing tool IDs from a list
   */
  getMissingToolIds(ids: string[]): Effect.Effect<string[]>;

  /**
   * Get all registered tools
   */
  getAllTools(): Effect.Effect<Tool[]>;

  /**
   * Check if a tool exists
   */
  hasTool(id: string): Effect.Effect<boolean>;

  /**
   * Remove a tool from the registry
   */
  removeTool(id: string): Effect.Effect<boolean>;

  /**
   * Clear all tools from the registry
   */
  clear(): Effect.Effect<void>;

  /**
   * Get the number of registered tools
   */
  size(): Effect.Effect<number>;

  /**
   * Get normalized tools for AI execution
   */
  normalizeTools(ids: string[]): Effect.Effect<Tool[]>;

  /**
   * Backwards-compatible alias for normalized tools as Record
   */
  toAISDKTools(ids: string[]): Effect.Effect<Record<string, Tool>>;
}

export const ToolRegistryService = Context.GenericTag<ToolRegistryService>(
  'ToolRegistryService'
);

/**
 * Implementation of ToolRegistryService
 */
class ToolRegistryServiceImpl implements ToolRegistryService {
  constructor(private tools: Ref.Ref<Map<string, Tool>>) {}

  registerTool(tool: Tool): Effect.Effect<void, ToolAlreadyExistsError | ToolValidationError> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);

      if (tools.has(tool.id)) {
        return yield* Effect.fail(new ToolAlreadyExistsError({ id: tool.id }));
      }

      // Validate tool schema
      try {
        validateToolSchema(tool);
      } catch (error) {
        return yield* Effect.fail(new ToolValidationError({
          id: tool.id,
          message: error instanceof Error ? error.message : String(error)
        }));
      }

      const newTools = new Map(tools);
      newTools.set(tool.id, tool);
      yield* Ref.set(this.tools, newTools);
    }.bind(this));
  }

  registerTools(tools: Tool[]): Effect.Effect<void, ToolAlreadyExistsError | ToolValidationError> {
    return Effect.gen(function* () {
      for (const tool of tools) {
        yield* this.registerTool(tool);
      }
    }.bind(this));
  }

  getTool(id: string): Effect.Effect<Tool, ToolNotFoundError> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      const tool = tools.get(id);
      if (!tool) {
        return yield* Effect.fail(new ToolNotFoundError({ id }));
      }
      return tool;
    }.bind(this));
  }

  getTools(ids: string[]): Effect.Effect<Tool[]> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      return ids.filter(id => tools.has(id)).map(id => tools.get(id)!);
    }.bind(this));
  }

  getMissingToolIds(ids: string[]): Effect.Effect<string[]> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      return ids.filter(id => !tools.has(id));
    }.bind(this));
  }

  getAllTools(): Effect.Effect<Tool[]> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      return Array.from(tools.values());
    }.bind(this));
  }

  hasTool(id: string): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      return tools.has(id);
    }.bind(this));
  }

  removeTool(id: string): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      const newTools = new Map(tools);
      const result = newTools.delete(id);
      yield* Ref.set(this.tools, newTools);
      return result;
    }.bind(this));
  }

  clear(): Effect.Effect<void> {
    return Ref.set(this.tools, new Map());
  }

  size(): Effect.Effect<number> {
    return Effect.gen(function* () {
      const tools = yield* Ref.get(this.tools);
      return tools.size;
    }.bind(this));
  }

  normalizeTools(ids: string[]): Effect.Effect<Tool[]> {
    return Effect.gen(function* () {
      const tools = yield* this.getTools(ids);
      return tools.map(tool => normalizeToolDefinition(tool, tool.execute));
    }.bind(this));
  }

  toAISDKTools(ids: string[]): Effect.Effect<Record<string, Tool>> {
    return Effect.gen(function* () {
      const tools = yield* this.normalizeTools(ids);
      return Object.fromEntries(tools.map(tool => [tool.id, tool]));
    }.bind(this));
  }
}

/**
 * Live layer providing ToolRegistryService
 */
export const ToolRegistryServiceLive = Layer.effect(
  ToolRegistryService,
  Effect.gen(function* () {
    const tools = yield* Ref.make(new Map<string, Tool>());
    return new ToolRegistryServiceImpl(tools);
  })
);
