import { Context, Effect, Layer, Ref } from 'effect';

/**
 * Global variable value types
 */
export type VariableValue = string | number | boolean;
export type VariableFactory = () => Effect.Effect<VariableValue>;

/**
 * Variable definition with Effect factory
 */
export interface Variable {
  name: string;
  factory: VariableFactory;
  mutable: boolean;
  description?: string;
}

/**
 * Variable state stored at runtime
 */
export interface VariableState {
  value: VariableValue;
  overridden: boolean;
  lastUpdated: Date;
}

/**
 * Global Variables Service for managing runtime context variables
 */
export interface GlobalVariablesService {
  /**
   * Register a new variable with an Effect factory
   */
  register(name: string, factory: VariableFactory, options?: {
    mutable?: boolean;
    description?: string;
  }): Effect.Effect<void>;

  /**
   * Register multiple variables at once
   */
  registerAll(variables: Record<string, VariableFactory>, options?: {
    mutable?: boolean;
  }): Effect.Effect<void>;

  /**
   * Get the current value of a variable (evaluates Effect)
   */
  get(name: string): Effect.Effect<VariableValue>;

  /**
   * Get all variable values (evaluates all Effects)
   */
  getAll(): Effect.Effect<Record<string, VariableValue>>;

  /**
   * Override a variable's value at runtime (if mutable)
   */
  set(name: string, value: VariableValue): Effect.Effect<void>;

  /**
   * Reset a variable back to its factory default
   */
  reset(name: string): Effect.Effect<void>;

  /**
   * Reset all variables back to factory defaults
   */
  resetAll(): Effect.Effect<void>;

  /**
   * Check if a variable exists
   */
  has(name: string): Effect.Effect<boolean>;

  /**
   * List all registered variable names
   */
  list(): Effect.Effect<string[]>;

  /**
   * Get variable metadata
   */
  getMetadata(name: string): Effect.Effect<{
    name: string;
    mutable: boolean;
    description?: string;
    overridden: boolean;
  }>;
}

export const GlobalVariablesService = Context.GenericTag<GlobalVariablesService>(
  'GlobalVariablesService'
);

/**
 * Implementation of GlobalVariablesService
 */
class GlobalVariablesServiceImpl implements GlobalVariablesService {
  constructor(
    private variables: Ref.Ref<Map<string, Variable>>,
    private overrides: Ref.Ref<Map<string, VariableState>>
  ) {}

  register(
    name: string,
    factory: VariableFactory,
    options?: { mutable?: boolean; description?: string }
  ): Effect.Effect<void> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      const newVars = new Map(vars);
      newVars.set(name, {
        name,
        factory,
        mutable: options?.mutable ?? true,
        description: options?.description,
      });
      yield* Ref.set(this.variables, newVars);
    }.bind(this));
  }

  registerAll(
    variables: Record<string, VariableFactory>,
    options?: { mutable?: boolean }
  ): Effect.Effect<void> {
    return Effect.gen(function* () {
      for (const [name, factory] of Object.entries(variables)) {
        yield* this.register(name, factory, options);
      }
    }.bind(this));
  }

  get(name: string): Effect.Effect<VariableValue> {
    return Effect.gen(function* () {
      const overrides = yield* Ref.get(this.overrides);
      const override = overrides.get(name);

      if (override) {
        return override.value;
      }

      const vars = yield* Ref.get(this.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      return yield* variable.factory();
    }.bind(this));
  }

  getAll(): Effect.Effect<Record<string, VariableValue>> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      const result: Record<string, VariableValue> = {};

      for (const [name] of vars) {
        result[name] = yield* this.get(name);
      }

      return result;
    }.bind(this));
  }

  set(name: string, value: VariableValue): Effect.Effect<void> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      if (!variable.mutable) {
        return yield* Effect.fail(new Error(`Variable "${name}" is not mutable`));
      }

      const overrides = yield* Ref.get(this.overrides);
      const newOverrides = new Map(overrides);
      newOverrides.set(name, {
        value,
        overridden: true,
        lastUpdated: new Date(),
      });
      yield* Ref.set(this.overrides, newOverrides);
    }.bind(this));
  }

  reset(name: string): Effect.Effect<void> {
    return Effect.gen(function* () {
      const overrides = yield* Ref.get(this.overrides);
      const newOverrides = new Map(overrides);
      newOverrides.delete(name);
      yield* Ref.set(this.overrides, newOverrides);
    }.bind(this));
  }

  resetAll(): Effect.Effect<void> {
    return Effect.gen(function* () {
      yield* Ref.set(this.overrides, new Map());
    }.bind(this));
  }

  has(name: string): Effect.Effect<boolean> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      return vars.has(name);
    }.bind(this));
  }

  list(): Effect.Effect<string[]> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      return Array.from(vars.keys());
    }.bind(this));
  }

  getMetadata(name: string): Effect.Effect<{
    name: string;
    mutable: boolean;
    description?: string;
    overridden: boolean;
  }> {
    return Effect.gen(function* () {
      const vars = yield* Ref.get(this.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      const overrides = yield* Ref.get(this.overrides);
      const overridden = overrides.has(name);

      return {
        name: variable.name,
        mutable: variable.mutable,
        description: variable.description,
        overridden,
      };
    }.bind(this));
  }
}

/**
 * Create a Live layer for GlobalVariablesService
 */
export const GlobalVariablesServiceLive = Layer.effect(
  GlobalVariablesService,
  Effect.gen(function* () {
    const variables = yield* Ref.make(new Map<string, Variable>());
    const overrides = yield* Ref.make(new Map<string, VariableState>());
    return new GlobalVariablesServiceImpl(variables, overrides);
  })
);
