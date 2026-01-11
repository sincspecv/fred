import { AgentConfig, AgentMessage, AgentResponse } from '../agent/agent';

/**
 * Agent reference in a pipeline - can be either:
 * - A string (agent ID) for externally defined agents
 * - An AgentConfig object for inline agent definitions
 */
export type PipelineAgentRef = string | AgentConfig;

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  id: string;
  agents: PipelineAgentRef[]; // Array of agent IDs or inline agent configs
  utterances?: string[]; // Phrases that trigger this pipeline (for intent matching)
  description?: string; // Optional description of the pipeline
}

/**
 * Pipeline instance (created from config)
 */
export interface PipelineInstance {
  id: string;
  config: PipelineConfig;
  execute: (message: string, previousMessages?: AgentMessage[]) => Promise<AgentResponse>;
}
