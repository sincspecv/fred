import { PipelineConfig, PipelineInstance, PipelineAgentRef, PipelineConfigV2 } from './pipeline';
import { PipelineStep } from './steps';
import { executePipelineV2 as executePipelineV2Fn, PipelineResult, ExecutorOptions } from './executor';
import { ContextManager } from '../context/manager';
import { Prompt } from '@effect/ai';
import { AgentManager } from '../agent/manager';
import { AgentMessage, AgentResponse } from '../agent/agent';
import { HookManager } from '../hooks/manager';
import { semanticMatch } from '../utils/semantic';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import {
  validateId,
  validateMessageLength,
  validatePipelineAgentCount,
  validatePipelineMessageCount,
  validateRegexPattern,
} from '../utils/validation';
import type { GraphWorkflowConfig } from './graph';
import { validateGraphWorkflow } from './graph-validator';
import { executeGraphWorkflow, type GraphExecutionResult } from './graph-executor';
import type { GraphWorkflowBuilder } from './graph-builder';
import type { CheckpointManager } from './checkpoint/manager';
import type { PipelineContext } from './context';
import type { HumanInputResumeOptions, PauseMetadata } from './pause/types';
import { PauseManager } from './pause/manager';

/**
 * Resume mode for pipeline continuation.
 * - 'skip': Start from the step after the checkpoint (default)
 * - 'retry': Re-execute the checkpointed step
 * - 'restart': Start from the beginning with restored context
 */
export type ResumeMode = 'skip' | 'retry' | 'restart';

/**
 * Options for resuming a pipeline.
 */
export interface ResumeOptions {
  /** Resume mode. Default: 'skip' */
  mode?: ResumeMode;

  /** Optional conversation ID for context management */
  conversationId?: string;
}

/**
 * Result of a resumed pipeline execution.
 */
export interface ResumeResult extends PipelineResult {
  /** The run ID that was resumed */
  runId: string;

  /** The step index from which execution resumed */
  resumedFromStep: number;
}

/**
 * Pipeline manager for lifecycle management
 */
export class PipelineManager {
  private pipelines: Map<string, PipelineInstance> = new Map();
  private pipelinesV2: Map<string, PipelineConfigV2> = new Map();
  private graphWorkflows: Map<string, GraphWorkflowConfig> = new Map();
  private agentManager: AgentManager;
  private tracer?: Tracer;
  private contextManager?: ContextManager;
  private hookManager?: HookManager;
  private checkpointManager?: CheckpointManager;
  private pauseManager?: PauseManager;

  constructor(agentManager: AgentManager, tracer?: Tracer, contextManager?: ContextManager) {
    this.agentManager = agentManager;
    this.tracer = tracer;
    this.contextManager = contextManager;
  }

  /**
   * Set the tracer for pipeline operations
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Set the context manager for shared memory
   */
  setContextManager(contextManager?: ContextManager): void {
    this.contextManager = contextManager;
  }

  /**
   * Set the hook manager for pipeline execution
   */
  setHookManager(hookManager?: HookManager): void {
    this.hookManager = hookManager;
  }

  /**
   * Set the checkpoint manager for resume operations
   */
  setCheckpointManager(manager?: CheckpointManager): void {
    this.checkpointManager = manager;
    // Create PauseManager when checkpoint manager is set
    if (manager) {
      this.pauseManager = new PauseManager({ checkpointManager: manager });
    } else {
      this.pauseManager = undefined;
    }
  }

  /**
   * Get the pause manager instance
   */
  getPauseManager(): PauseManager | undefined {
    return this.pauseManager;
  }

  /**
   * Create a pipeline from configuration
   */
  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    // Validate pipeline ID
    validateId(config.id, 'Pipeline ID');

    if (this.pipelines.has(config.id)) {
      throw new Error(`Pipeline with id "${config.id}" already exists`);
    }

    // Validate agent count
    validatePipelineAgentCount(config.agents.length);

    // Validate and resolve agent references
    const agentIds: string[] = [];
    for (const agentRef of config.agents) {
      if (typeof agentRef === 'string') {
        // Validate agent ID format
        validateId(agentRef, 'Agent ID');
        // External agent reference - validate it exists
        if (!this.agentManager.hasAgent(agentRef)) {
          throw new Error(`Pipeline "${config.id}" references agent "${agentRef}" which does not exist`);
        }
        agentIds.push(agentRef);
      } else {
        // Inline agent definition - create the agent
        if (!agentRef.id) {
          throw new Error(`Inline agent in pipeline "${config.id}" must have an id`);
        }
        // Validate inline agent ID
        validateId(agentRef.id, 'Inline agent ID');
        // Check if agent already exists
        if (this.agentManager.hasAgent(agentRef.id)) {
          // Use existing agent
          agentIds.push(agentRef.id);
        } else {
          // Create new agent
          await this.agentManager.createAgent(agentRef);
          agentIds.push(agentRef.id);
        }
      }
    }

    if (agentIds.length === 0) {
      throw new Error(`Pipeline "${config.id}" must have at least one agent`);
    }

    // Create the pipeline execution function
    const execute = async (
      message: string,
      previousMessages: AgentMessage[] = []
    ): Promise<AgentResponse> => {
      return this.executePipeline(config.id, message, previousMessages);
    };

    const instance: PipelineInstance = {
      id: config.id,
      config,
      execute,
    };

    this.pipelines.set(config.id, instance);
    return instance;
  }

  /**
   * Get a pipeline by ID
   */
  getPipeline(id: string): PipelineInstance | undefined {
    return this.pipelines.get(id);
  }

  /**
   * Check if a pipeline exists
   */
  hasPipeline(id: string): boolean {
    return this.pipelines.has(id);
  }

  /**
   * Remove a pipeline
   */
  removePipeline(id: string): boolean {
    return this.pipelines.delete(id);
  }

  /**
   * Get all pipelines
   */
  getAllPipelines(): PipelineInstance[] {
    return Array.from(this.pipelines.values());
  }

  /**
   * Clear all pipelines
   */
  clear(): void {
    this.pipelines.clear();
    this.pipelinesV2.clear();
    this.graphWorkflows.clear();
  }

  // ==========================================
  // V2 Pipeline Methods
  // ==========================================

  /**
   * Create a V2 pipeline from configuration
   */
  async createPipelineV2(config: PipelineConfigV2): Promise<void> {
    validateId(config.id, 'Pipeline ID');

    if (this.pipelinesV2.has(config.id)) {
      throw new Error(`Pipeline with id "${config.id}" already exists`);
    }

    // Validate steps
    if (!config.steps || config.steps.length === 0) {
      throw new Error(`Pipeline "${config.id}" must have at least one step`);
    }

    // Validate step names are unique
    const stepNames = new Set<string>();
    for (const step of config.steps) {
      if (stepNames.has(step.name)) {
        throw new Error(`Duplicate step name "${step.name}" in pipeline "${config.id}"`);
      }
      stepNames.add(step.name);

      // Validate agent steps reference existing agents
      if (step.type === 'agent' && !this.agentManager.hasAgent(step.agentId)) {
        console.warn(`Pipeline "${config.id}" step "${step.name}" references unknown agent "${step.agentId}"`);
      }

      // Validate nested pipeline steps
      if (step.type === 'pipeline' && !this.pipelinesV2.has(step.pipelineId) && !this.pipelines.has(step.pipelineId)) {
        console.warn(`Pipeline "${config.id}" step "${step.name}" references unknown pipeline "${step.pipelineId}"`);
      }
    }

    this.pipelinesV2.set(config.id, config);
  }

  /**
   * Get a V2 pipeline by ID
   */
  getPipelineV2(id: string): PipelineConfigV2 | undefined {
    return this.pipelinesV2.get(id);
  }

  /**
   * Check if a V2 pipeline exists
   */
  hasPipelineV2(id: string): boolean {
    return this.pipelinesV2.has(id);
  }

  /**
   * Get all V2 pipelines
   */
  getAllPipelinesV2(): PipelineConfigV2[] {
    return Array.from(this.pipelinesV2.values());
  }

  /**
   * Execute a V2 pipeline
   */
  async executePipelineV2(
    pipelineId: string,
    input: string,
    options?: {
      conversationId?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<PipelineResult> {
    const config = this.pipelinesV2.get(pipelineId);
    if (!config) {
      throw new Error(`V2 Pipeline not found: ${pipelineId}`);
    }

    const executorOptions: ExecutorOptions = {
      agentManager: this.agentManager,
      hookManager: this.hookManager,
      tracer: this.tracer,
      pipelineManager: {
        getPipeline: (id: string) => {
          // Check V2 pipelines first
          const v2Config = this.pipelinesV2.get(id);
          if (v2Config) {
            return {
              execute: async (msg: string) => {
                const result = await this.executePipelineV2(id, msg, options);
                // Convert PipelineResult to AgentResponse-like
                return {
                  content: typeof result.finalOutput === 'string'
                    ? result.finalOutput
                    : JSON.stringify(result.finalOutput ?? ''),
                  toolCalls: [],
                };
              },
            };
          }
          // Fall back to V1 pipelines
          return this.pipelines.get(id);
        },
      },
    };

    return executePipelineV2Fn(config, input, {
      ...executorOptions,
      conversationId: options?.conversationId,
      history: options?.history,
    });
  }

  // ==========================================
  // Resume Methods
  // ==========================================

  /**
   * Resume a V2 pipeline from a checkpoint.
   *
   * Loads the checkpoint for the given run ID and continues execution
   * from the appropriate step based on the resume mode.
   *
   * @param runId - The run identifier to resume
   * @param options - Resume options including mode and conversation ID
   * @returns Resume result with run metadata
   * @throws If checkpoint manager not configured
   * @throws If no checkpoint found for run ID
   * @throws If checkpoint status is 'in_progress' (concurrency guard)
   */
  async resume(runId: string, options?: ResumeOptions): Promise<ResumeResult> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not configured. Set with setCheckpointManager()');
    }

    // Get latest checkpoint
    const checkpoint = await this.checkpointManager.getLatestCheckpoint(runId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for run ID: ${runId}`);
    }

    // Concurrency guard: prevent duplicate resume
    if (checkpoint.status === 'in_progress') {
      throw new Error(`Run ${runId} is already in progress. Cannot resume concurrently.`);
    }

    // Determine resume mode
    const mode = options?.mode ?? 'skip';
    let startStep: number;

    switch (mode) {
      case 'retry':
        startStep = checkpoint.step; // Re-execute the step that was checkpointed
        break;
      case 'skip':
        startStep = checkpoint.step + 1; // Skip to next step
        break;
      case 'restart':
        startStep = 0; // Restart from beginning with restored context
        break;
      default:
        throw new Error(`Invalid resume mode: ${mode}`);
    }

    // Get pipeline config
    const config = this.pipelinesV2.get(checkpoint.pipelineId);
    if (!config) {
      throw new Error(`Pipeline ${checkpoint.pipelineId} not found`);
    }

    // Mark as in_progress before starting
    await this.checkpointManager.updateStatus(runId, checkpoint.step, 'in_progress');

    try {
      // Execute from resume point
      const result = await this.executePipelineV2FromStep(
        config,
        checkpoint.context.input,
        {
          startStep,
          restoredContext: checkpoint.context,
          conversationId: options?.conversationId,
          runId,
        }
      );

      // Check for execution failure (executor returns success:false with error)
      if (!result.success) {
        await this.checkpointManager.markFailed(runId, checkpoint.step);
        if (result.error) {
          throw result.error;
        }
        throw new Error(result.abortedBy ? `Pipeline aborted by: ${result.abortedBy}` : 'Pipeline execution failed');
      }

      // Mark as completed on success
      const finalStep = config.steps.length - 1;
      await this.checkpointManager.markCompleted(runId, finalStep);

      return {
        ...result,
        runId,
        resumedFromStep: startStep,
      };
    } catch (error) {
      // Mark as failed on error (if not already marked)
      // Note: error may have been thrown after marking failed above
      if (error instanceof Error && !error.message.includes('Pipeline aborted') && !error.message.includes('Pipeline execution failed')) {
        await this.checkpointManager.markFailed(runId, checkpoint.step);
      }
      throw error;
    }
  }

  /**
   * Resume a paused V2 pipeline with human input.
   *
   * Loads the paused checkpoint, validates human input if schema provided,
   * merges input into context as USER message, and resumes execution.
   *
   * @param runId - The run identifier to resume
   * @param options - Human input and resume options
   * @returns Resume result with run metadata
   * @throws If checkpoint manager not configured
   * @throws If no paused checkpoint found for run ID
   * @throws If checkpoint status is not 'paused'
   * @throws If input validation fails (when schema provided)
   */
  async resumeWithHumanInput(
    runId: string,
    options: HumanInputResumeOptions
  ): Promise<ResumeResult> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not configured. Set with setCheckpointManager()');
    }

    // Get latest checkpoint
    const checkpoint = await this.checkpointManager.getLatestCheckpoint(runId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for run ID: ${runId}`);
    }

    // Must be paused status
    if (checkpoint.status !== 'paused') {
      throw new Error(
        `Run ${runId} is not paused (status: ${checkpoint.status}). ` +
        `Use resume() for non-paused checkpoints.`
      );
    }

    // Check for expiration
    if (checkpoint.expiresAt && checkpoint.expiresAt < new Date()) {
      // Mark as expired
      await this.checkpointManager.updateStatus(runId, checkpoint.step, 'expired' as any);
      throw new Error(
        `Pause request expired at ${checkpoint.expiresAt.toISOString()}. ` +
        `Prompt was: "${checkpoint.pauseMetadata?.prompt}"`
      );
    }

    const pauseMetadata = checkpoint.pauseMetadata;

    // Validate human input against schema if provided
    if (pauseMetadata?.schema && options.humanInput) {
      this.validateHumanInput(options.humanInput, pauseMetadata.schema);
    }

    // Validate choice if choices were specified
    if (pauseMetadata?.choices && pauseMetadata.choices.length > 0) {
      if (!pauseMetadata.choices.includes(options.humanInput)) {
        throw new Error(
          `Invalid choice: "${options.humanInput}". ` +
          `Valid choices: ${pauseMetadata.choices.join(', ')}`
        );
      }
    }

    // Merge human input into context as USER message
    const updatedContext: PipelineContext = {
      ...checkpoint.context,
      history: [
        ...checkpoint.context.history,
        {
          role: 'user',
          content: options.humanInput,
        },
      ],
    };

    // Determine resume step based on resumeBehavior
    const resumeBehavior = options.resumeBehavior ?? pauseMetadata?.resumeBehavior ?? 'continue';
    let startStep: number;

    if (resumeBehavior === 'rerun') {
      startStep = checkpoint.step; // Re-execute the step that triggered pause
    } else {
      startStep = checkpoint.step + 1; // Continue to next step
    }

    // Get pipeline config
    const config = this.pipelinesV2.get(checkpoint.pipelineId);
    if (!config) {
      throw new Error(`Pipeline ${checkpoint.pipelineId} not found`);
    }

    // Mark as in_progress before starting (concurrency guard)
    try {
      await this.checkpointManager.updateStatus(runId, checkpoint.step, 'in_progress');
    } catch (err) {
      throw new Error(
        `Cannot resume: concurrent modification or checkpoint not found. ` +
        `Another process may be resuming this run.`
      );
    }

    try {
      // Execute from resume point with updated context
      const result = await this.executePipelineV2FromStep(
        config,
        checkpoint.context.input,
        {
          startStep,
          restoredContext: updatedContext,
          conversationId: options.conversationId,
          runId,
        }
      );

      // Handle result
      if (!result.success && result.status !== 'paused') {
        // Failed (but not paused again)
        await this.checkpointManager.markFailed(runId, checkpoint.step);
        if (result.error) {
          throw result.error;
        }
        throw new Error(result.abortedBy ? `Pipeline aborted by: ${result.abortedBy}` : 'Pipeline execution failed');
      }

      // If paused again, don't mark completed
      if (result.status !== 'paused') {
        // Mark as completed on success
        const finalStep = config.steps.length - 1;
        await this.checkpointManager.markCompleted(runId, finalStep);
      }

      return {
        ...result,
        runId,
        resumedFromStep: startStep,
      };
    } catch (error) {
      // Mark as failed on error
      if (error instanceof Error && !error.message.includes('Pipeline aborted') && !error.message.includes('Pipeline execution failed')) {
        await this.checkpointManager.markFailed(runId, checkpoint.step);
      }
      throw error;
    }
  }

  /**
   * Validate human input against JSON Schema.
   * Basic validation - checks required properties and types.
   */
  private validateHumanInput(input: string, schema: Record<string, unknown>): void {
    // Basic validation - for JSON input, try to parse and check structure
    // For simple string input, just ensure non-empty
    if (!input || input.trim().length === 0) {
      throw new Error('Human input cannot be empty');
    }

    // If schema expects object, try to parse JSON
    if (schema.type === 'object') {
      try {
        const parsed = JSON.parse(input);
        // Check required properties if specified
        const required = schema.required as string[] | undefined;
        if (required && Array.isArray(required)) {
          for (const prop of required) {
            if (!(prop in parsed)) {
              throw new Error(`Missing required property: ${prop}`);
            }
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error('Invalid JSON input: ' + e.message);
        }
        throw e;
      }
    }
  }

  /**
   * Execute a V2 pipeline from a specific step.
   * Internal method used by resume() to continue execution from a checkpoint.
   */
  private async executePipelineV2FromStep(
    config: PipelineConfigV2,
    input: string,
    options: {
      startStep: number;
      restoredContext?: PipelineContext;
      conversationId?: string;
      runId?: string;
    }
  ): Promise<PipelineResult> {
    const executorOptions: ExecutorOptions = {
      agentManager: this.agentManager,
      hookManager: this.hookManager,
      tracer: this.tracer,
      pipelineManager: {
        getPipeline: (id: string) => {
          const v2Config = this.pipelinesV2.get(id);
          if (v2Config) {
            return {
              execute: async (msg: string) => {
                const result = await this.executePipelineV2(id, msg);
                return {
                  content: typeof result.finalOutput === 'string'
                    ? result.finalOutput
                    : JSON.stringify(result.finalOutput ?? ''),
                  toolCalls: [],
                };
              },
            };
          }
          return this.pipelines.get(id);
        },
      },
    };

    // Execute with extended options for resume support
    // Note: executePipelineV2Fn will be extended in 09-03 to support startStep and restoredContext
    return executePipelineV2Fn(config, input, {
      ...executorOptions,
      conversationId: options.conversationId,
      startStep: options.startStep,
      restoredContext: options.restoredContext,
      runId: options.runId,
    } as any); // Type cast needed until executor is updated in 09-03
  }

  /**
   * Match a message against pipeline utterances
   * Returns the matching pipeline ID if found, null otherwise
   * Uses the same hybrid strategy as AgentManager: exact → regex → semantic
   */
  async matchPipelineByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Promise<{ pipelineId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null> {
    const normalizedMessage = message.toLowerCase().trim();

    // Get all pipelines with utterances
    const pipelinesWithUtterances = Array.from(this.pipelines.values()).filter(
      pipeline => pipeline.config.utterances && pipeline.config.utterances.length > 0
    );

    // Try exact match first
    for (const pipeline of pipelinesWithUtterances) {
      const utterances = pipeline.config.utterances!;
      for (const utterance of utterances) {
        if (normalizedMessage === utterance.toLowerCase().trim()) {
          return {
            pipelineId: pipeline.id,
            confidence: 1.0,
            matchType: 'exact',
          };
        }
      }
    }

    // Try regex match (with ReDoS protection)
    for (const pipeline of pipelinesWithUtterances) {
      const utterances = pipeline.config.utterances!;
      for (const utterance of utterances) {
        // Validate regex pattern to prevent ReDoS attacks
        if (!validateRegexPattern(utterance)) {
          // Skip invalid or dangerous regex patterns
          continue;
        }
        try {
          const regex = new RegExp(utterance, 'i');
          if (regex.test(message)) {
            return {
              pipelineId: pipeline.id,
              confidence: 0.8,
              matchType: 'regex',
            };
          }
        } catch {
          // Invalid regex, skip
          continue;
        }
      }
    }

    // Try semantic matching if provided
    if (semanticMatcher) {
      for (const pipeline of pipelinesWithUtterances) {
        const utterances = pipeline.config.utterances!;
        const result = await semanticMatcher(message, utterances);
        if (result.matched) {
          return {
            pipelineId: pipeline.id,
            confidence: result.confidence,
            matchType: 'semantic',
          };
        }
      }
    }

    return null;
  }

  /**
   * Execute a pipeline by chaining agents together
   * Each agent receives the most recent message as primary input and preceding messages as history
   */
  async executePipeline(
    pipelineId: string,
    message: string,
    previousMessages: AgentMessage[] = [],
    options?: {
      conversationId?: string;
      appendToContext?: boolean;
      sequentialVisibility?: boolean;
    }
  ): Promise<AgentResponse> {
    // Validate inputs
    validateId(pipelineId, 'Pipeline ID');
    validateMessageLength(message);
    validatePipelineMessageCount(previousMessages.length);

    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    // Create span for pipeline execution
    const pipelineSpan = this.tracer?.startSpan('pipeline.execute', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'pipeline.id': pipelineId,
        'pipeline.agentCount': pipeline.config.agents.length,
        'message.length': message.length,
        'history.length': previousMessages.length,
      },
    });

    const previousActiveSpan = this.tracer?.getActiveSpan();
    if (pipelineSpan) {
      this.tracer?.setActiveSpan(pipelineSpan);
    }

    try {
      // Current message to pass to the next agent (starts with original user message)
      let currentMessage = message;
      // History to pass to the next agent (starts with conversation history)
      let currentHistory: AgentMessage[] = [...previousMessages];
      const appendToContext = options?.appendToContext ?? true;
      const sequentialVisibility = options?.sequentialVisibility ?? true;
      const conversationId = options?.conversationId;

      let finalResponse: AgentResponse | null = null;

      // Execute each agent in sequence
      for (let i = 0; i < pipeline.config.agents.length; i++) {
        const agentRef = pipeline.config.agents[i];
        const agentId = typeof agentRef === 'string' ? agentRef : agentRef.id;

        // Create span for individual agent execution within pipeline
        const agentSpan = this.tracer?.startSpan('pipeline.agent.execute', {
          kind: SpanKind.INTERNAL,
          attributes: {
            'pipeline.id': pipelineId,
            'pipeline.agentIndex': i,
            'pipeline.agentId': agentId,
            'pipeline.totalAgents': pipeline.config.agents.length,
          },
        });

        const previousAgentSpan = this.tracer?.getActiveSpan();
        if (agentSpan) {
          this.tracer?.setActiveSpan(agentSpan);
        }

        try {
          const agent = this.agentManager.getAgent(agentId);
          if (!agent) {
            throw new Error(`Agent "${agentId}" not found in pipeline "${pipelineId}"`);
          }

          // Process message through agent: pass most recent message as primary input,
          // and preceding messages as history
          const response = await agent.processMessage(
            currentMessage,
            sequentialVisibility ? currentHistory : []
          );

          if (agentSpan) {
            agentSpan.setAttributes({
              'response.length': response.content.length,
              'response.hasToolCalls': (response.toolCalls?.length ?? 0) > 0,
              'response.hasHandoff': response.handoff !== undefined,
            });
            agentSpan.setStatus('ok');
          }

          // Validate response content length
          validateMessageLength(response.content);

          // Update for next agent:
          // - Add the current message (input to this agent) to history
          const userEntry: AgentMessage = {
            role: 'user',
            content: currentMessage,
          };
          const assistantEntry: AgentMessage = {
            role: 'assistant',
            content: response.content,
          };

          currentHistory.push(userEntry);
          if (response.content) {
            currentHistory.push(assistantEntry);
          }

          // Only persist to context if agent allows it (default: true)
          const shouldPersistHistory = agent.config.persistHistory !== false;
          if (appendToContext && this.contextManager && conversationId && shouldPersistHistory) {
            const messagesToAdd: Prompt.MessageEncoded[] = [userEntry];

            if (response.toolCalls && response.toolCalls.length > 0) {
              const baseTimestamp = Date.now();
              const toolCallIds = response.toolCalls.map(
                (toolCall, idx) => `call_${toolCall.toolId}_${baseTimestamp}_${idx}`
              );
              const assistantParts: Array<Prompt.AssistantMessagePartEncoded> = [];
              if (response.content) {
                assistantParts.push(Prompt.makePart('text', { text: response.content }));
              }
              response.toolCalls.forEach((toolCall, idx) => {
                assistantParts.push(
                  Prompt.makePart('tool-call', {
                    id: toolCallIds[idx],
                    name: toolCall.toolId,
                    params: toolCall.args,
                    providerExecuted: false,
                  })
                );
              });
              messagesToAdd.push({ role: 'assistant', content: assistantParts });

              for (let idx = 0; idx < response.toolCalls.length; idx++) {
                const toolCall = response.toolCalls[idx];
                if (toolCall.result !== undefined) {
                  messagesToAdd.push({
                    role: 'tool',
                    content: [
                      Prompt.makePart('tool-result', {
                        id: toolCallIds[idx],
                        name: toolCall.toolId,
                        result: toolCall.result,
                        isFailure: false,
                        providerExecuted: false,
                      }),
                    ],
                  });
                }
              }
            } else if (response.content) {
              messagesToAdd.push(assistantEntry);
            }

            await this.contextManager.addMessages(conversationId, messagesToAdd);
          }

          // - The next agent's primary message is this agent's response
          currentMessage = response.content;

          // Validate accumulated message count after each agent
          validatePipelineMessageCount(currentHistory.length);

          // Store response (will be overwritten by next agent, final one is what we return)
          finalResponse = response;

          // Note: Sequential pipelines ignore handoff requests since execution order is predetermined.
          // For dynamic agent delegation, use graph workflows with the handoff tool.
        } catch (error) {
          if (agentSpan && error instanceof Error) {
            agentSpan.recordException(error);
            agentSpan.setStatus('error', error.message);
          }
          // Log error but continue with pipeline if possible
          console.error(`Error in pipeline "${pipelineId}" at agent "${agentId}":`, error);
          // Re-throw to stop pipeline execution
          throw error;
        } finally {
          if (agentSpan) {
            agentSpan.end();
            if (previousAgentSpan) {
              this.tracer?.setActiveSpan(previousAgentSpan);
            } else {
              this.tracer?.setActiveSpan(pipelineSpan);
            }
          }
        }
      }

      if (!finalResponse) {
        throw new Error(`Pipeline "${pipelineId}" did not produce a response`);
      }

      if (pipelineSpan) {
        pipelineSpan.setAttributes({
          'response.length': finalResponse.content.length,
          'response.hasToolCalls': (finalResponse.toolCalls?.length ?? 0) > 0,
        });
        pipelineSpan.setStatus('ok');
      }

      return finalResponse;
    } catch (error) {
      if (pipelineSpan && error instanceof Error) {
        pipelineSpan.recordException(error);
        pipelineSpan.setStatus('error', error.message);
      }
      throw error;
    } finally {
      if (pipelineSpan) {
        pipelineSpan.end();
        if (previousActiveSpan) {
          this.tracer?.setActiveSpan(previousActiveSpan);
        } else {
          this.tracer?.setActiveSpan(undefined);
        }
      }
    }
  }

  // ==========================================
  // Graph Workflow Methods
  // ==========================================

  /**
   * Register a graph workflow configuration
   */
  registerGraphWorkflow(config: GraphWorkflowConfig): void {
    validateId(config.id, 'Graph workflow ID');

    if (this.graphWorkflows.has(config.id)) {
      throw new Error(`Graph workflow with id "${config.id}" already exists`);
    }

    // Validate the graph workflow (throws on error)
    validateGraphWorkflow(config);

    // Validate agent nodes reference existing agents
    for (const node of config.nodes) {
      if (node.type === 'agent' && !this.agentManager.hasAgent(node.agentId)) {
        console.warn(`Graph workflow "${config.id}" node "${node.id}" references unknown agent "${node.agentId}"`);
      }
    }

    this.graphWorkflows.set(config.id, config);
    console.log(`Registered graph workflow: ${config.id}`);
  }

  /**
   * Get a graph workflow by ID
   */
  getGraphWorkflow(id: string): GraphWorkflowConfig | undefined {
    return this.graphWorkflows.get(id);
  }

  /**
   * Check if a graph workflow exists
   */
  hasGraphWorkflow(id: string): boolean {
    return this.graphWorkflows.has(id);
  }

  /**
   * Get all graph workflows
   */
  getAllGraphWorkflows(): GraphWorkflowConfig[] {
    return Array.from(this.graphWorkflows.values());
  }

  /**
   * Execute a graph workflow
   */
  async executeGraphWorkflow(
    id: string,
    input: string,
    options?: {
      conversationId?: string;
    }
  ): Promise<GraphExecutionResult> {
    const config = this.graphWorkflows.get(id);
    if (!config) {
      throw new Error(`Graph workflow not found: ${id}`);
    }

    return executeGraphWorkflow(config, input, {
      agentManager: this.agentManager,
      hookManager: this.hookManager,
      tracer: this.tracer,
      pipelineManager: {
        getPipeline: (pipelineId: string) => {
          // Check V2 pipelines first
          const v2Config = this.pipelinesV2.get(pipelineId);
          if (v2Config) {
            return {
              execute: async (msg: string) => {
                const result = await this.executePipelineV2(pipelineId, msg, options);
                return {
                  content: typeof result.finalOutput === 'string'
                    ? result.finalOutput
                    : JSON.stringify(result.finalOutput ?? ''),
                  toolCalls: [],
                };
              },
            };
          }
          // Fall back to V1 pipelines
          return this.pipelines.get(pipelineId);
        },
      },
    });
  }

  /**
   * Create a graph workflow from a builder and register it
   */
  createGraphWorkflowFromBuilder(builder: GraphWorkflowBuilder): GraphWorkflowConfig {
    const config = builder.build();
    this.registerGraphWorkflow(config);
    return config;
  }
}
