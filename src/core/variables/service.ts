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
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      const newVars = new Map(vars);
      newVars.set(name, {
        name,
        factory,
        mutable: options?.mutable ?? true,
        description: options?.description,
      });
      yield* Ref.set(self.variables, newVars);
    });
  }

  registerAll(
    variables: Record<string, VariableFactory>,
    options?: { mutable?: boolean }
  ): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      for (const [name, factory] of Object.entries(variables)) {
        yield* self.register(name, factory, options);
      }
    });
  }

  get(name: string): Effect.Effect<VariableValue> {
    const self = this;
    return Effect.gen(function* () {
      const overrides = yield* Ref.get(self.overrides);
      const override = overrides.get(name);

      if (override) {
        return override.value;
      }

      const vars = yield* Ref.get(self.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      return yield* variable.factory();
    }).pipe(Effect.orDie);
  }

  getAll(): Effect.Effect<Record<string, VariableValue>> {
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      const result: Record<string, VariableValue> = {};

      for (const [name] of vars) {
        result[name] = yield* self.get(name);
      }

      return result;
    });
  }

  set(name: string, value: VariableValue): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      if (!variable.mutable) {
        return yield* Effect.fail(new Error(`Variable "${name}" is not mutable`));
      }

      const overrides = yield* Ref.get(self.overrides);
      const newOverrides = new Map(overrides);
      newOverrides.set(name, {
        value,
        overridden: true,
        lastUpdated: new Date(),
      });
      yield* Ref.set(self.overrides, newOverrides);
    }).pipe(Effect.orDie);
  }

  reset(name: string): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const overrides = yield* Ref.get(self.overrides);
      const newOverrides = new Map(overrides);
      newOverrides.delete(name);
      yield* Ref.set(self.overrides, newOverrides);
    });
  }

  resetAll(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Ref.set(self.overrides, new Map());
    });
  }

  has(name: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      return vars.has(name);
    });
  }

  list(): Effect.Effect<string[]> {
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      return Array.from(vars.keys());
    });
  }

  getMetadata(name: string): Effect.Effect<{
    name: string;
    mutable: boolean;
    description?: string;
    overridden: boolean;
  }> {
    const self = this;
    return Effect.gen(function* () {
      const vars = yield* Ref.get(self.variables);
      const variable = vars.get(name);

      if (!variable) {
        return yield* Effect.fail(new Error(`Variable "${name}" not found`));
      }

      const overrides = yield* Ref.get(self.overrides);
      const overridden = overrides.has(name);

      return {
        name: variable.name,
        mutable: variable.mutable,
        description: variable.description,
        overridden,
      };
    }).pipe(Effect.orDie);
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
