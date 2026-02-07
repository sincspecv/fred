import { Context, Effect, Layer, Ref } from 'effect';
import type { Tool } from './tool';
import { withInferredCapabilities } from './capabilities';
import { ToolNotFoundError, ToolAlreadyExistsError, ToolValidationError } from './errors';
import { validateToolSchema } from './validation';
import { normalizeToolDefinition } from './utils';

/**
 * Effect-wrapped tool schema validation
 */
const validateToolSchemaEffect = (tool: Tool): Effect.Effect<void, ToolValidationError> =>
  Effect.try({
    try: () => validateToolSchema(tool),
    catch: (error) => new ToolValidationError({
      id: tool.id,
      message: error instanceof Error ? error.message : String(error)
    })
  });

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
    const self = this;
    return Effect.gen(function* () {
      const tools = yield* Ref.get(self.tools);

      if (tools.has(tool.id)) {
        return yield* Effect.fail(new ToolAlreadyExistsError({ id: tool.id }));
      }

      const toolWithCapabilities = withInferredCapabilities(tool);

      // Validate tool schema using Effect
      yield* validateToolSchemaEffect(toolWithCapabilities);

      const newTools = new Map(tools);
      newTools.set(tool.id, toolWithCapabilities);
      yield* Ref.set(self.tools, newTools);
    });
  }

  registerTools(tools: Tool[]): Effect.Effect<void, ToolAlreadyExistsError | ToolValidationError> {
    const self = this;
    return Effect.gen(function* () {
      for (const tool of tools) {
        yield* self.registerTool(tool);
      }
    });
  }

  getTool(id: string): Effect.Effect<Tool, ToolNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const tools = yield* Ref.get(self.tools);
      const tool = tools.get(id);
      if (!tool) {
        return yield* Effect.fail(new ToolNotFoundError({ id }));
      }
      return tool;
    });
  }

  getTools(ids: string[]): Effect.Effect<Tool[]> {
    const self = this;
    return Ref.get(self.tools).pipe(
      Effect.map((tools) => ids.filter(id => tools.has(id)).map(id => tools.get(id)!))
    );
  }

  getMissingToolIds(ids: string[]): Effect.Effect<string[]> {
    const self = this;
    return Ref.get(self.tools).pipe(
      Effect.map((tools) => ids.filter(id => !tools.has(id)))
    );
  }

  getAllTools(): Effect.Effect<Tool[]> {
    const self = this;
    return Ref.get(self.tools).pipe(
      Effect.map((tools) => Array.from(tools.values()))
    );
  }

  hasTool(id: string): Effect.Effect<boolean> {
    const self = this;
    return Ref.get(self.tools).pipe(
      Effect.map((tools) => tools.has(id))
    );
  }

  removeTool(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const tools = yield* Ref.get(self.tools);
      const newTools = new Map(tools);
      const result = newTools.delete(id);
      yield* Ref.set(self.tools, newTools);
      return result;
    });
  }

  clear(): Effect.Effect<void> {
    return Ref.set(this.tools, new Map());
  }

  size(): Effect.Effect<number> {
    return Ref.get(this.tools).pipe(
      Effect.map((tools) => tools.size)
    );
  }

  normalizeTools(ids: string[]): Effect.Effect<Tool[]> {
    const self = this;
    return self.getTools(ids).pipe(
      Effect.map((tools) => tools.map(tool => normalizeToolDefinition(tool, tool.execute)))
    );
  }

  toAISDKTools(ids: string[]): Effect.Effect<Record<string, Tool>> {
    const self = this;
    return self.normalizeTools(ids).pipe(
      Effect.map((tools) => Object.fromEntries(tools.map(tool => [tool.id, tool])))
    );
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
