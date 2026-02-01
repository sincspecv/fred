import { AgentConfig, AgentMessage, AgentResponse } from '../agent/agent';
import { HookHandler } from '../hooks/types';
import { PipelineStep } from './steps';

/**
 * Agent reference in a pipeline - can be either:
 * - A string (agent ID) for externally defined agents
 * - An AgentConfig object for inline agent definitions
 */
export type PipelineAgentRef = string | AgentConfig;

/**
 * Checkpoint configuration for pipeline execution.
 */
export interface CheckpointConfig {
  /** Enable/disable checkpointing. Default: true when storage configured */
  enabled?: boolean;

  /** TTL in milliseconds for checkpoints. Default: 7 days */
  ttlMs?: number;
}

/**
 * Pipeline configuration (V1 - legacy agent-based pipelines)
 */
export interface PipelineConfig {
  id: string;
  agents: PipelineAgentRef[]; // Array of agent IDs or inline agent configs
  utterances?: string[]; // Phrases that trigger this pipeline (for intent matching)
  description?: string; // Optional description of the pipeline
}

/**
 * Per-pipeline hook configuration
 * Hooks fire at deterministic points during pipeline execution
 */
export interface PipelineHooks {
  /** Hooks executed before pipeline starts */
  beforePipeline?: HookHandler[];
  /** Hooks executed after pipeline completes */
  afterPipeline?: HookHandler[];
  /** Hooks executed before each step */
  beforeStep?: HookHandler[];
  /** Hooks executed after each step completes */
  afterStep?: HookHandler[];
  /** Hooks executed when a step errors (after all retries fail) */
  onStepError?: HookHandler[];
}

/**
 * Extended pipeline configuration (Phase 5+)
 * Supports all step types with per-step configuration
 */
export interface PipelineConfigV2 {
  /** Unique pipeline identifier */
  id: string;
  /** Ordered array of pipeline steps */
  steps: PipelineStep[];
  /** Optional description of the pipeline */
  description?: string;
  /** Phrases that trigger this pipeline (for utterance matching) */
  utterances?: string[];
  /** Per-pipeline hook configuration */
  hooks?: PipelineHooks;
  /** Stop on first error (default: true) */
  failFast?: boolean;
  /** Checkpoint configuration for resume support */
  checkpoint?: CheckpointConfig;
}

/**
 * Union type for backward compatibility - accepts both V1 and V2 configs
 */
export type AnyPipelineConfig = PipelineConfig | PipelineConfigV2;

/**
 * Type guard to distinguish V2 pipeline configs from V1
 * @param config - Pipeline configuration to check
 * @returns true if config is PipelineConfigV2
 */
export function isPipelineConfigV2(config: AnyPipelineConfig): config is PipelineConfigV2 {
  return 'steps' in config && Array.isArray(config.steps);
}

/**
 * Pipeline instance (created from config)
 */
export interface PipelineInstance {
  id: string;
  config: PipelineConfig;
  execute: (message: string, previousMessages?: AgentMessage[]) => Promise<AgentResponse>;
}
