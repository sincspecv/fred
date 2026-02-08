import type { Tool } from './tool';
import { withInferredCapabilities } from './capabilities';
import { normalizeToolDefinition } from './utils';
import { validateToolSchema } from './validation';
import { Effect, LogLevel } from 'effect';
import { redact, type RedactionFilter, type RedactionContext } from '../observability/errors';
import { shouldLogEvent, type VerbosityOverrides } from '../observability/otel';

/**
 * Centralized tool registry
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private redactionFilter?: RedactionFilter;
  private verbosityOverrides?: VerbosityOverrides;
  private logLevel: LogLevel.LogLevel = LogLevel.Info;

  /**
   * Register a tool in the registry
   */
  registerTool(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool with id "${tool.id}" is already registered`);
    }
    const toolWithCapabilities = withInferredCapabilities(tool);
    validateToolSchema(toolWithCapabilities);
    this.tools.set(tool.id, toolWithCapabilities);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /**
   * Get multiple tools by their IDs
   */
  getTools(ids: string[]): Tool[] {
    const tools: Tool[] = [];
    for (const id of ids) {
      const tool = this.getTool(id);
      if (tool) {
        tools.push(tool);
      }
    }
    return tools;
  }

  getMissingToolIds(ids: string[]): string[] {
    return ids.filter((id) => !this.tools.has(id));
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool exists
   */
  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * Remove a tool from the registry
   */
  removeTool(id: string): boolean {
    return this.tools.delete(id);
  }

  /**
   * Clear all tools from the registry
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the number of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  normalizeTools(ids: string[]): Tool[] {
    const tools = this.getTools(ids);
    return tools.map((toolDef) => normalizeToolDefinition(toolDef, toolDef.execute));
  }

  /**
   * Backwards-compatible alias for normalized tools
   */
  toAISDKTools(ids: string[]): Record<string, Tool> {
    const tools = this.normalizeTools(ids);
    return Object.fromEntries(tools.map((tool) => [tool.id, tool]));
  }

  /**
   * Set custom redaction filter for tool payload logging.
   */
  setRedactionFilter(filter: RedactionFilter): void {
    this.redactionFilter = filter;
  }

  /**
   * Set verbosity overrides for controlling high-volume event logging.
   */
  setVerbosityOverrides(overrides: VerbosityOverrides): void {
    this.verbosityOverrides = overrides;
  }

  /**
   * Set current log level for payload redaction decisions.
   */
  setLogLevel(level: LogLevel.LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Log tool invocation with redaction applied.
   *
   * @param toolId - Tool being invoked
   * @param input - Tool input arguments
   * @returns Effect that logs the invocation
   */
  logToolInvocation(toolId: string, input: unknown): Effect.Effect<void> {
    // Only log at debug level or if verbosity allows
    if (!shouldLogEvent('other', this.logLevel, this.verbosityOverrides)) {
      return Effect.void;
    }

    const context: RedactionContext = {
      payloadType: 'request',
      source: `tool:${toolId}`,
      logLevel: this.logLevel,
    };

    const redactedInput = redact(input, context, this.redactionFilter);

    return Effect.logDebug(`Tool invocation: ${toolId}`).pipe(
      Effect.annotateLogs({
        toolId,
        input: redactedInput,
      })
    );
  }

  /**
   * Log tool result with redaction applied.
   *
   * @param toolId - Tool that completed
   * @param output - Tool output result
   * @returns Effect that logs the result
   */
  logToolResult(toolId: string, output: unknown): Effect.Effect<void> {
    // Only log at debug level or if verbosity allows
    if (!shouldLogEvent('other', this.logLevel, this.verbosityOverrides)) {
      return Effect.void;
    }

    const context: RedactionContext = {
      payloadType: 'response',
      source: `tool:${toolId}`,
      logLevel: this.logLevel,
    };

    const redactedOutput = redact(output, context, this.redactionFilter);

    return Effect.logDebug(`Tool result: ${toolId}`).pipe(
      Effect.annotateLogs({
        toolId,
        output: redactedOutput,
      })
    );
  }
}
