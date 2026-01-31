import { Effect } from 'effect';
import * as Schema from 'effect/Schema';
import { Tool } from '@effect/ai';
import { GlobalVariablesService, type VariableValue } from './service.js';

/**
 * Create Effect AI tools for managing global variables
 */
export function createVariableTools() {
  const getVariableTool = Tool.make('get_variable', {
    description: 'Get the current value of a global context variable like currentDate, currentTime, or timezone',
    parameters: {
      name: Schema.String.annotations({
        description: 'The variable name to retrieve (e.g., "currentDate", "currentTime", "timezone")',
      }),
    },
    success: Schema.Struct({
      success: Schema.Boolean,
      name: Schema.String,
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
    }),
  });

  const setVariableTool = Tool.make('set_variable', {
    description: 'Override a mutable global context variable. Use this to update context like marking a certain date or setting a custom value.',
    parameters: {
      name: Schema.String.annotations({
        description: 'The variable name to set',
      }),
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean).annotations({
        description: 'The new value for the variable',
      }),
    },
    success: Schema.Struct({
      success: Schema.Boolean,
      name: Schema.String,
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
      message: Schema.String,
    }),
  });

  const listVariablesTool = Tool.make('list_variables', {
    description: 'List all available global context variables and their current values',
    parameters: {},
    success: Schema.Struct({
      success: Schema.Boolean,
      variables: Schema.Array(Schema.Struct({
        name: Schema.String,
        value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
      })),
    }),
  });

  const resetVariableTool = Tool.make('reset_variable', {
    description: 'Reset a variable back to its default factory value',
    parameters: {
      name: Schema.String.annotations({
        description: 'The variable name to reset',
      }),
    },
    success: Schema.Struct({
      success: Schema.Boolean,
      name: Schema.String,
      value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
      message: Schema.String,
    }),
  });

  // Create tool handlers that execute the tools with GlobalVariablesService
  const handleGetVariable = ({ name }: { name: string }) =>
    Effect.gen(function* () {
      const service = yield* GlobalVariablesService;
      const value = yield* service.get(name);
      return { success: true as const, name, value };
    });

  const handleSetVariable = ({ name, value }: { name: string; value: VariableValue }) =>
    Effect.gen(function* () {
      const service = yield* GlobalVariablesService;
      yield* service.set(name, value);
      return { success: true as const, name, value, message: `Variable "${name}" set to ${value}` };
    });

  const handleListVariables = () =>
    Effect.gen(function* () {
      const service = yield* GlobalVariablesService;
      const names = yield* service.list();
      const values = yield* service.getAll();
      return {
        success: true as const,
        variables: names.map(name => ({
          name,
          value: values[name],
        })),
      };
    });

  const handleResetVariable = ({ name }: { name: string }) =>
    Effect.gen(function* () {
      const service = yield* GlobalVariablesService;
      yield* service.reset(name);
      const newValue = yield* service.get(name);
      return {
        success: true as const,
        name,
        value: newValue,
        message: `Variable "${name}" reset to default: ${newValue}`,
      };
    });

  return {
    tools: {
      getVariableTool,
      setVariableTool,
      listVariablesTool,
      resetVariableTool,
    },
    handlers: {
      get_variable: handleGetVariable,
      set_variable: handleSetVariable,
      list_variables: handleListVariables,
      reset_variable: handleResetVariable,
    },
  };
}
