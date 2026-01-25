import {
  PipelineStep,
  AgentStep,
  FunctionStep,
  ConditionalStep,
  PipelineRefStep,
  RetryConfig,
  PipelineContext,
} from './steps';
import { PipelineConfigV2, PipelineHooks } from './pipeline';
import { HookHandler } from '../hooks/types';

/**
 * Step options for builder methods
 */
export interface StepOptions {
  name?: string;  // Override auto-generated name
  retry?: RetryConfig;
  contextView?: 'accumulated' | 'isolated';
}

/**
 * Fluent builder for constructing PipelineConfigV2.
 *
 * @example
 * ```typescript
 * const pipeline = new PipelineBuilder('data-processing')
 *   .addAgentStep('validator')
 *   .addFunctionStep('transform', async (ctx) => transformData(ctx.input))
 *   .addConditionalStep('check-complete', {
 *     condition: (ctx) => !ctx.outputs['validator']?.incomplete,
 *     whenTrue: [{ type: 'agent', agentId: 'enricher', name: 'enrich' }],
 *   })
 *   .build();
 * ```
 */
export class PipelineBuilder {
  private id: string;
  private steps: PipelineStep[] = [];
  private description?: string;
  private utterances?: string[];
  private hooks: PipelineHooks = {};
  private failFast: boolean = true;
  private stepNames: Set<string> = new Set();

  constructor(id: string) {
    if (!id || id.trim() === '') {
      throw new Error('Pipeline ID is required');
    }
    this.id = id;
  }

  /**
   * Set pipeline description.
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Add utterances for intent matching.
   */
  addUtterances(utterances: string[]): this {
    this.utterances = [...(this.utterances ?? []), ...utterances];
    return this;
  }

  /**
   * Set fail-fast behavior (default: true).
   */
  setFailFast(failFast: boolean): this {
    this.failFast = failFast;
    return this;
  }

  /**
   * Add an agent step.
   */
  addAgentStep(agentId: string, options?: StepOptions): this {
    const name = this.resolveName(options?.name ?? agentId);
    const step: AgentStep = {
      type: 'agent',
      name,
      agentId,
      retry: options?.retry,
      contextView: options?.contextView,
    };
    this.steps.push(step);
    return this;
  }

  /**
   * Add a function step.
   */
  addFunctionStep(
    nameOrFn: string | ((ctx: PipelineContext) => unknown | Promise<unknown>),
    fnOrOptions?: ((ctx: PipelineContext) => unknown | Promise<unknown>) | StepOptions,
    options?: StepOptions
  ): this {
    let name: string;
    let fn: (ctx: PipelineContext) => unknown | Promise<unknown>;
    let opts: StepOptions | undefined;

    if (typeof nameOrFn === 'function') {
      // addFunctionStep(fn, options?)
      fn = nameOrFn;
      name = this.resolveName(`fn-${this.steps.length}`);
      opts = fnOrOptions as StepOptions | undefined;
    } else {
      // addFunctionStep(name, fn, options?)
      name = this.resolveName(nameOrFn);
      fn = fnOrOptions as (ctx: PipelineContext) => unknown | Promise<unknown>;
      opts = options;
    }

    const step: FunctionStep = {
      type: 'function',
      name,
      fn,
      retry: opts?.retry,
      contextView: opts?.contextView,
    };
    this.steps.push(step);
    return this;
  }

  /**
   * Add a conditional step.
   */
  addConditionalStep(
    name: string,
    config: {
      condition: (ctx: PipelineContext) => boolean | Promise<boolean>;
      whenTrue: PipelineStep[];
      whenFalse?: PipelineStep[];
    },
    options?: Omit<StepOptions, 'name'>
  ): this {
    const resolvedName = this.resolveName(name);
    const step: ConditionalStep = {
      type: 'conditional',
      name: resolvedName,
      condition: config.condition,
      whenTrue: config.whenTrue,
      whenFalse: config.whenFalse,
      retry: options?.retry,
      contextView: options?.contextView,
    };
    this.steps.push(step);
    return this;
  }

  /**
   * Add a nested pipeline step.
   */
  addPipelineStep(pipelineId: string, options?: StepOptions): this {
    const name = this.resolveName(options?.name ?? `pipeline-${pipelineId}`);
    const step: PipelineRefStep = {
      type: 'pipeline',
      name,
      pipelineId,
      retry: options?.retry,
      contextView: options?.contextView,
    };
    this.steps.push(step);
    return this;
  }

  /**
   * Add a raw step (for advanced use cases).
   */
  addStep(step: PipelineStep): this {
    this.validateStepName(step.name);
    this.stepNames.add(step.name);
    this.steps.push(step);
    return this;
  }

  /**
   * Register a hook for this pipeline.
   */
  addHook(
    type: 'beforePipeline' | 'afterPipeline' | 'beforeStep' | 'afterStep' | 'onStepError',
    handler: HookHandler
  ): this {
    if (!this.hooks[type]) {
      this.hooks[type] = [];
    }
    this.hooks[type]!.push(handler);
    return this;
  }

  /**
   * Build the pipeline configuration.
   */
  build(): PipelineConfigV2 {
    if (this.steps.length === 0) {
      throw new Error(`Pipeline "${this.id}" must have at least one step`);
    }

    const config: PipelineConfigV2 = {
      id: this.id,
      steps: this.steps,
      failFast: this.failFast,
    };

    if (this.description) {
      config.description = this.description;
    }

    if (this.utterances && this.utterances.length > 0) {
      config.utterances = this.utterances;
    }

    if (Object.keys(this.hooks).length > 0) {
      config.hooks = this.hooks;
    }

    return config;
  }

  /**
   * Resolve step name, ensuring uniqueness.
   */
  private resolveName(baseName: string): string {
    let name = baseName;
    let counter = 1;

    while (this.stepNames.has(name)) {
      name = `${baseName}-${counter}`;
      counter++;
    }

    this.stepNames.add(name);
    return name;
  }

  /**
   * Validate step name is unique.
   */
  private validateStepName(name: string): void {
    if (this.stepNames.has(name)) {
      throw new Error(`Step name "${name}" already exists in pipeline "${this.id}"`);
    }
  }
}
