import { Effect } from 'effect';
import * as Schema from 'effect/Schema';
import { Tool, Toolkit } from '@effect/ai';
import { GlobalVariablesService, type VariableValue } from './service.js';

/**
 * Create Effect AI tools for managing global variables
 */
export function createVariableTools() {
  const getVariableTool = Tool.make({
    name: 'get_variable',
    description: 'Get the current value of a global context variable like currentDate, currentTime, or timezone',
    parameters: Schema.Struct({
      name: Schema.String.annotations({
        description: 'The variable name to retrieve (e.g., "currentDate", "currentTime", "timezone")',
      }),
    }),
    execute: ({ name }) =>
      Effect.gen(function* () {
        const service = yield* GlobalVariablesService;
        const value = yield* service.get(name);
        return { success: true, name, value };
      }),
  });

  const setVariableTool = Tool.make({
    name: 'set_variable',
    description: 'Override a mutable global context variable. Use this to update context like marking a certain date or setting a custom value.',
    parameters: Schema.Struct({
      name: Schema.String.annotations({
        description: 'The variable name to set',
      }),
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean).annotations({
        description: 'The new value for the variable',
      }),
    }),
    execute: ({ name, value }) =>
      Effect.gen(function* () {
        const service = yield* GlobalVariablesService;
        yield* service.set(name, value as VariableValue);
        return { success: true, name, value, message: `Variable "${name}" set to ${value}` };
      }),
  });

  const listVariablesTool = Tool.make({
    name: 'list_variables',
    description: 'List all available global context variables and their current values',
    parameters: Schema.Struct({}),
    execute: () =>
      Effect.gen(function* () {
        const service = yield* GlobalVariablesService;
        const names = yield* service.list();
        const values = yield* service.getAll();
        return {
          success: true,
          variables: names.map(name => ({
            name,
            value: values[name],
          })),
        };
      }),
  });

  const resetVariableTool = Tool.make({
    name: 'reset_variable',
    description: 'Reset a variable back to its default factory value',
    parameters: Schema.Struct({
      name: Schema.String.annotations({
        description: 'The variable name to reset',
      }),
    }),
    execute: ({ name }) =>
      Effect.gen(function* () {
        const service = yield* GlobalVariablesService;
        yield* service.reset(name);
        const newValue = yield* service.get(name);
        return {
          success: true,
          name,
          value: newValue,
          message: `Variable "${name}" reset to default: ${newValue}`,
        };
      }),
  });

  return {
    getVariableTool,
    setVariableTool,
    listVariablesTool,
    resetVariableTool,
  };
}
