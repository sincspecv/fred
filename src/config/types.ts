import { Intent } from '../core/intent/intent';
import { AgentConfig } from '../core/agent/agent';
import { Tool } from '../core/tool/tool';
import { PipelineConfig } from '../core/pipeline/pipeline';

/**
 * Fred framework configuration structure for config files
 */
export interface FrameworkConfig {
  intents?: Intent[];
  agents?: AgentConfig[];
  pipelines?: PipelineConfig[];
  tools?: Omit<Tool, 'execute'>[]; // Tool definitions without execute function (will be registered separately)
}

/**
 * Config file format
 */
export type ConfigFormat = 'json' | 'yaml';

