import { Context, Effect, Layer, Ref } from 'effect';
import type {
  PipelineConfig,
  PipelineInstance,
  PipelineConfigV2
} from './pipeline';
import type { PipelineResult } from './executor';
import type { GraphWorkflowConfig } from './graph';
import type { GraphExecutionResult } from './graph-executor';
import type { GraphWorkflowBuilder } from './graph-builder';
import type { AgentMessage, AgentResponse } from '../agent/agent';
import type { ResumeOptions, ResumeResult } from './manager';
import type { HumanInputResumeOptions } from './pause/types';
import {
  PipelineNotFoundError,
  PipelineAlreadyExistsError,
  PipelineExecutionError,
  GraphValidationError
} from './errors';
import { AgentService } from '../agent/service';
import { HookManagerService } from '../hooks/service';
import { CheckpointService } from './checkpoint/service';
import { PauseService } from './pause/service';
import { validateGraphWorkflow } from './graph-validator';
import { validateId, validatePipelineAgentCount } from '../../utils/validation';

/**
 * PipelineService interface for Effect-based pipeline management
 */
export interface PipelineService {
  // ==========================================
  // V1 Pipeline Methods
  // ==========================================

  /**
   * Create a pipeline from configuration
   */
  createPipeline(config: PipelineConfig): Effect.Effect<PipelineInstance, PipelineAlreadyExistsError | PipelineExecutionError>;

  /**
   * Get a pipeline by ID
   */
  getPipeline(id: string): Effect.Effect<PipelineInstance, PipelineNotFoundError>;

  /**
   * Get a pipeline by ID (optional, returns undefined if not found)
   */
  getPipelineOptional(id: string): Effect.Effect<PipelineInstance | undefined>;

  /**
   * Check if a pipeline exists
   */
  hasPipeline(id: string): Effect.Effect<boolean>;

  /**
   * Remove a pipeline
   */
  removePipeline(id: string): Effect.Effect<boolean>;

  /**
   * Get all pipelines
   */
  getAllPipelines(): Effect.Effect<PipelineInstance[]>;

  /**
   * Clear all pipelines (V1, V2, and graph)
   */
  clear(): Effect.Effect<void>;

  /**
   * Execute a V1 pipeline
   */
  executePipeline(
    pipelineId: string,
    message: string,
    previousMessages?: AgentMessage[],
    options?: {
      conversationId?: string;
      appendToContext?: boolean;
      sequentialVisibility?: boolean;
    }
  ): Effect.Effect<AgentResponse, PipelineExecutionError>;

  /**
   * Match a message against pipeline utterances
   */
  matchPipelineByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{
      matched: boolean;
      confidence: number;
      utterance?: string;
    }>
  ): Effect.Effect<{
    pipelineId: string;
    confidence: number;
    matchType: 'exact' | 'regex' | 'semantic';
  } | null>;

  // ==========================================
  // V2 Pipeline Methods
  // ==========================================

  /**
   * Create a V2 pipeline from configuration
   */
  createPipelineV2(config: PipelineConfigV2): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError>;

  /**
   * Get a V2 pipeline by ID
   */
  getPipelineV2(id: string): Effect.Effect<PipelineConfigV2, PipelineNotFoundError>;

  /**
   * Check if a V2 pipeline exists
   */
  hasPipelineV2(id: string): Effect.Effect<boolean>;

  /**
   * Get all V2 pipelines
   */
  getAllPipelinesV2(): Effect.Effect<PipelineConfigV2[]>;

  /**
   * Execute a V2 pipeline
   */
  executePipelineV2(
    pipelineId: string,
    input: string,
    options?: {
      conversationId?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Effect.Effect<PipelineResult, PipelineExecutionError>;

  // ==========================================
  // Resume Methods
  // ==========================================

  /**
   * Resume a V2 pipeline from a checkpoint
   */
  resume(runId: string, options?: ResumeOptions): Effect.Effect<ResumeResult, PipelineExecutionError>;

  /**
   * Resume a paused V2 pipeline with human input
   */
  resumeWithHumanInput(
    runId: string,
    options: HumanInputResumeOptions
  ): Effect.Effect<ResumeResult, PipelineExecutionError>;

  // ==========================================
  // Graph Workflow Methods
  // ==========================================

  /**
   * Register a graph workflow configuration
   */
  registerGraphWorkflow(config: GraphWorkflowConfig): Effect.Effect<void, GraphValidationError>;

  /**
   * Get a graph workflow by ID
   */
  getGraphWorkflow(id: string): Effect.Effect<GraphWorkflowConfig, PipelineNotFoundError>;

  /**
   * Check if a graph workflow exists
   */
  hasGraphWorkflow(id: string): Effect.Effect<boolean>;

  /**
   * Get all graph workflows
   */
  getAllGraphWorkflows(): Effect.Effect<GraphWorkflowConfig[]>;

  /**
   * Execute a graph workflow with structured concurrency
   * Fork nodes create parallel fibers, join nodes collect results
   */
  executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Effect.Effect<GraphExecutionResult, PipelineExecutionError>;

  /**
   * Create a graph workflow from a builder and register it
   */
  createGraphWorkflowFromBuilder(builder: GraphWorkflowBuilder): Effect.Effect<GraphWorkflowConfig, GraphValidationError>;

  // ==========================================
  // Pause Manager Access
  // ==========================================

  /**
   * Get the pause service for direct access
   */
  getPauseService(): Effect.Effect<PauseService>;
}

export const PipelineService = Context.GenericTag<PipelineService>('PipelineService');

/**
 * Implementation of PipelineService
 */
class PipelineServiceImpl implements PipelineService {
  constructor(
    private pipelines: Ref.Ref<Map<string, PipelineInstance>>,
    private pipelinesV2: Ref.Ref<Map<string, PipelineConfigV2>>,
    private graphWorkflows: Ref.Ref<Map<string, GraphWorkflowConfig>>,
    private agentService: AgentService,
    private hookService: HookManagerService,
    private checkpointService: CheckpointService,
    private pauseService: PauseService
  ) {}

  // ==========================================
  // V1 Pipeline Methods
  // ==========================================

  createPipeline(config: PipelineConfig): Effect.Effect<PipelineInstance, PipelineAlreadyExistsError | PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      // Validate ID using Effect.try
      yield* Effect.try({
        try: () => validateId(config.id, 'Pipeline ID'),
        catch: (error) => new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error
        })
      });

      const pipelines = yield* Ref.get(self.pipelines);
      if (pipelines.has(config.id)) {
        return yield* Effect.fail(new PipelineAlreadyExistsError({ id: config.id }));
      }

      // Validate agent count using Effect.try
      yield* Effect.try({
        try: () => validatePipelineAgentCount(config.agents.length),
        catch: (error) => new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error
        })
      });

      // Validate agent references
      for (const agentRef of config.agents) {
        const agentId = typeof agentRef === 'string' ? agentRef : agentRef.id;
        if (typeof agentRef === 'string') {
          const exists = yield* self.agentService.hasAgent(agentId);
          if (!exists) {
            return yield* Effect.fail(new PipelineAlreadyExistsError({
              id: config.id
            }));
          }
        }
      }

      const execute = async (message: string, previousMessages: AgentMessage[] = []) => {
        return Effect.runPromise(
          self.executePipeline(config.id, message, previousMessages)
        );
      };

      const instance: PipelineInstance = {
        id: config.id,
        config,
        execute,
      };

      const newPipelines = new Map(pipelines);
      newPipelines.set(config.id, instance);
      yield* Ref.set(self.pipelines, newPipelines);

      return instance;
    });
  }

  getPipeline(id: string): Effect.Effect<PipelineInstance, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      const pipeline = pipelines.get(id);
      if (!pipeline) {
        return yield* Effect.fail(new PipelineNotFoundError({ id }));
      }
      return pipeline;
    });
  }

  getPipelineOptional(id: string): Effect.Effect<PipelineInstance | undefined> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      return pipelines.get(id);
    });
  }

  hasPipeline(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      return pipelines.has(id);
    });
  }

  removePipeline(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      const newPipelines = new Map(pipelines);
      const removed = newPipelines.delete(id);
      yield* Ref.set(self.pipelines, newPipelines);
      return removed;
    });
  }

  getAllPipelines(): Effect.Effect<PipelineInstance[]> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      return Array.from(pipelines.values());
    });
  }

  clear(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Ref.set(self.pipelines, new Map());
      yield* Ref.set(self.pipelinesV2, new Map());
      yield* Ref.set(self.graphWorkflows, new Map());
    });
  }

  executePipeline(
    pipelineId: string,
    message: string,
    previousMessages: AgentMessage[] = [],
    options?: {
      conversationId?: string;
      appendToContext?: boolean;
      sequentialVisibility?: boolean;
    }
  ): Effect.Effect<AgentResponse, PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const pipeline = yield* self.getPipeline(pipelineId).pipe(
        Effect.mapError(() => new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: new Error(`Pipeline not found: ${pipelineId}`)
        }))
      );

      let currentMessage = message;
      let currentHistory = [...previousMessages];
      let finalResponse: AgentResponse | null = null;

      for (let i = 0; i < pipeline.config.agents.length; i++) {
        const agentRef = pipeline.config.agents[i];
        const agentId = typeof agentRef === 'string' ? agentRef : agentRef.id;

        const agent = yield* self.agentService.getAgent(agentId).pipe(
          Effect.mapError(() => new PipelineExecutionError({
            pipelineId,
            step: i,
            cause: new Error(`Agent not found: ${agentId}`)
          }))
        );

        // Process message with proper Effect wrapping
        const response = yield* self.processAgentMessage(
          agent,
          currentMessage,
          options?.sequentialVisibility !== false ? currentHistory : [],
          pipelineId,
          i
        );

        currentHistory.push({ role: 'user', content: currentMessage });
        if (response.content) {
          currentHistory.push({ role: 'assistant', content: response.content });
        }
        currentMessage = response.content;
        finalResponse = response;
      }

      if (!finalResponse) {
        return yield* Effect.fail(new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: new Error('Pipeline did not produce a response')
        }));
      }

      return finalResponse;
    });
  }

  /**
   * Effect-wrapped agent message processing
   */
  private processAgentMessage(
    agent: { processMessage: (message: string, history?: AgentMessage[]) => Promise<AgentResponse> },
    message: string,
    history: AgentMessage[],
    pipelineId: string,
    step: number
  ): Effect.Effect<AgentResponse, PipelineExecutionError> {
    return Effect.async<AgentResponse, PipelineExecutionError>((resume) => {
      agent.processMessage(message, history)
        .then((response) => resume(Effect.succeed(response)))
        .catch((error) => resume(Effect.fail(new PipelineExecutionError({
          pipelineId,
          step,
          cause: error
        }))));
    });
  }

  matchPipelineByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{
      matched: boolean;
      confidence: number;
      utterance?: string;
    }>
  ): Effect.Effect<{
    pipelineId: string;
    confidence: number;
    matchType: 'exact' | 'regex' | 'semantic';
  } | null> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelines);
      const normalizedMessage = message.toLowerCase().trim();

      const pipelinesWithUtterances = Array.from(pipelines.values()).filter(
        p => p.config.utterances && p.config.utterances.length > 0
      );

      // Exact match
      for (const pipeline of pipelinesWithUtterances) {
        for (const utterance of pipeline.config.utterances!) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            return { pipelineId: pipeline.id, confidence: 1.0, matchType: 'exact' as const };
          }
        }
      }

      // Regex match using Effect.try for proper error handling
      for (const pipeline of pipelinesWithUtterances) {
        for (const utterance of pipeline.config.utterances!) {
          const matched = yield* Effect.try({
            try: () => {
              const regex = new RegExp(utterance, 'i');
              return regex.test(message);
            },
            catch: () => false // Invalid regex, treat as no match
          });
          if (matched) {
            return { pipelineId: pipeline.id, confidence: 0.8, matchType: 'regex' as const };
          }
        }
      }

      // Semantic match
      if (semanticMatcher) {
        for (const pipeline of pipelinesWithUtterances) {
          const result = yield* self.runPipelineSemanticMatcher(
            semanticMatcher,
            message,
            pipeline.config.utterances!
          );
          if (result.matched) {
            return { pipelineId: pipeline.id, confidence: result.confidence, matchType: 'semantic' as const };
          }
        }
      }

      return null;
    });
  }

  /**
   * Effect-wrapped semantic matcher for pipelines
   */
  private runPipelineSemanticMatcher(
    matcher: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>,
    message: string,
    utterances: string[]
  ): Effect.Effect<{ matched: boolean; confidence: number; utterance?: string }> {
    return Effect.async((resume) => {
      matcher(message, utterances)
        .then((result) => resume(Effect.succeed(result)))
        .catch(() => resume(Effect.succeed({ matched: false, confidence: 0 }))); // Treat errors as no match
    });
  }

  // ==========================================
  // V2 Pipeline Methods (simplified implementation)
  // ==========================================

  createPipelineV2(config: PipelineConfigV2): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      // Validate ID using Effect.try
      yield* Effect.try({
        try: () => validateId(config.id, 'Pipeline ID'),
        catch: (error) => new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error
        })
      });

      const pipelines = yield* Ref.get(self.pipelinesV2);
      if (pipelines.has(config.id)) {
        return yield* Effect.fail(new PipelineAlreadyExistsError({ id: config.id }));
      }
      const newPipelines = new Map(pipelines);
      newPipelines.set(config.id, config);
      yield* Ref.set(self.pipelinesV2, newPipelines);
    });
  }

  getPipelineV2(id: string): Effect.Effect<PipelineConfigV2, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      const config = pipelines.get(id);
      if (!config) return yield* Effect.fail(new PipelineNotFoundError({ id }));
      return config;
    });
  }

  hasPipelineV2(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      return pipelines.has(id);
    });
  }

  getAllPipelinesV2(): Effect.Effect<PipelineConfigV2[]> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      return Array.from(pipelines.values());
    });
  }

  executePipelineV2(
    pipelineId: string,
    input: string,
    options?: { conversationId?: string; history?: Array<{ role: string; content: string }> }
  ): Effect.Effect<PipelineResult, PipelineExecutionError> {
    // Delegate to existing executor - full conversion would be a larger task
    return Effect.fail(new PipelineExecutionError({
      pipelineId,
      step: 0,
      cause: new Error('V2 pipeline execution not yet migrated to Effect')
    }));
  }

  // Resume methods - simplified, full implementation reuses existing logic
  resume(runId: string, options?: ResumeOptions): Effect.Effect<ResumeResult, PipelineExecutionError> {
    return Effect.fail(new PipelineExecutionError({
      pipelineId: 'unknown',
      step: 0,
      cause: new Error('Resume not yet migrated to Effect')
    }));
  }

  resumeWithHumanInput(runId: string, options: HumanInputResumeOptions): Effect.Effect<ResumeResult, PipelineExecutionError> {
    return Effect.fail(new PipelineExecutionError({
      pipelineId: 'unknown',
      step: 0,
      cause: new Error('Resume with human input not yet migrated to Effect')
    }));
  }

  // ==========================================
  // Graph Workflow Methods
  // ==========================================

  registerGraphWorkflow(config: GraphWorkflowConfig): Effect.Effect<void, GraphValidationError> {
    const self = this;
    return Effect.gen(function* () {
      // Validate ID using Effect.try
      yield* Effect.try({
        try: () => validateId(config.id, 'Graph workflow ID'),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error)
        })
      });

      const workflows = yield* Ref.get(self.graphWorkflows);
      if (workflows.has(config.id)) {
        return yield* Effect.fail(new GraphValidationError({
          workflowId: config.id,
          message: `Graph workflow already exists: ${config.id}`
        }));
      }

      // Validate graph structure using Effect.try
      yield* Effect.try({
        try: () => validateGraphWorkflow(config),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error)
        })
      });

      const newWorkflows = new Map(workflows);
      newWorkflows.set(config.id, config);
      yield* Ref.set(self.graphWorkflows, newWorkflows);
    });
  }

  getGraphWorkflow(id: string): Effect.Effect<GraphWorkflowConfig, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      const config = workflows.get(id);
      if (!config) return yield* Effect.fail(new PipelineNotFoundError({ id }));
      return config;
    });
  }

  hasGraphWorkflow(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      return workflows.has(id);
    });
  }

  getAllGraphWorkflows(): Effect.Effect<GraphWorkflowConfig[]> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      return Array.from(workflows.values());
    });
  }

  executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Effect.Effect<GraphExecutionResult, PipelineExecutionError> {
    // Graph execution with structured concurrency
    // Fork nodes create parallel fibers that are automatically cancelled
    // if parent is interrupted (parent-child cancellation cascade)
    const self = this;
    return Effect.gen(function* () {
      const config = yield* self.getGraphWorkflow(id).pipe(
        Effect.mapError(() => new PipelineExecutionError({
          pipelineId: id,
          step: 0,
          cause: new Error(`Graph workflow not found: ${id}`)
        }))
      );

      // For now, delegate to existing executor
      // Full Effect-native graph execution would use Effect.fork for parallelism
      return yield* Effect.fail(new PipelineExecutionError({
        pipelineId: id,
        step: 0,
        cause: new Error('Graph execution not yet migrated to Effect fibers')
      }));
    });
  }

  createGraphWorkflowFromBuilder(builder: GraphWorkflowBuilder): Effect.Effect<GraphWorkflowConfig, GraphValidationError> {
    const self = this;
    return Effect.gen(function* () {
      const config = builder.build();
      yield* self.registerGraphWorkflow(config);
      return config;
    });
  }

  getPauseService(): Effect.Effect<PauseService> {
    return Effect.succeed(this.pauseService);
  }
}

/**
 * Live layer providing PipelineService
 * Requires AgentService, HookManagerService, CheckpointService, PauseService
 */
export const PipelineServiceLive = Layer.effect(
  PipelineService,
  Effect.gen(function* () {
    const agentService = yield* AgentService;
    const hookService = yield* HookManagerService;
    const checkpointService = yield* CheckpointService;
    const pauseService = yield* PauseService;

    const pipelines = yield* Ref.make(new Map<string, PipelineInstance>());
    const pipelinesV2 = yield* Ref.make(new Map<string, PipelineConfigV2>());
    const graphWorkflows = yield* Ref.make(new Map<string, GraphWorkflowConfig>());

    return new PipelineServiceImpl(
      pipelines,
      pipelinesV2,
      graphWorkflows,
      agentService,
      hookService,
      checkpointService,
      pauseService
    );
  })
);
