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
  createPipeline(config: PipelineConfig): Effect.Effect<PipelineInstance, PipelineAlreadyExistsError>;

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
  createPipelineV2(config: PipelineConfigV2): Effect.Effect<void, PipelineAlreadyExistsError>;

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
