import { FrameworkConfig } from './types';
import { parseConfigFile } from './parser';
import { Intent } from '../core/intent/intent';
import { AgentConfig } from '../core/agent/agent';
import { PipelineConfig } from '../core/pipeline/pipeline';
import { Tool } from '../core/tool/tool';
import { loadPromptFile } from '../utils/prompt-loader';
import { validateId, validatePipelineAgentCount } from '../utils/validation';

/**
 * Load configuration from a file
 */
export function loadConfig(filePath: string): FrameworkConfig {
  return parseConfigFile(filePath);
}

/**
 * Validate config structure
 */
export function validateConfig(config: FrameworkConfig): void {
  if (config.intents) {
    for (const intent of config.intents) {
      if (!intent.id) {
        throw new Error('Intent must have an id');
      }
      if (!intent.utterances || intent.utterances.length === 0) {
        throw new Error(`Intent "${intent.id}" must have at least one utterance`);
      }
      if (!intent.action) {
        throw new Error(`Intent "${intent.id}" must have an action`);
      }
      if (!intent.action.type || !intent.action.target) {
        throw new Error(`Intent "${intent.id}" action must have type and target`);
      }
    }
  }

  if (config.agents) {
    for (const agent of config.agents) {
      if (!agent.id) {
        throw new Error('Agent must have an id');
      }
      if (!agent.systemMessage) {
        throw new Error(`Agent "${agent.id}" must have a systemMessage`);
      }
      if (!agent.platform) {
        throw new Error(`Agent "${agent.id}" must have a platform`);
      }
      if (!agent.model) {
        throw new Error(`Agent "${agent.id}" must have a model`);
      }
    }
  }

  if (config.tools) {
    for (const tool of config.tools) {
      if (!tool.id) {
        throw new Error('Tool must have an id');
      }
      if (!tool.name) {
        throw new Error(`Tool "${tool.id}" must have a name`);
      }
      if (!tool.description) {
        throw new Error(`Tool "${tool.id}" must have a description`);
      }
      if (!tool.parameters) {
        throw new Error(`Tool "${tool.id}" must have parameters`);
      }
    }
  }

  if (config.pipelines) {
    for (const pipeline of config.pipelines) {
      if (!pipeline.id) {
        throw new Error('Pipeline must have an id');
      }
      // Validate pipeline ID format
      validateId(pipeline.id, 'Pipeline ID');
      
      if (!pipeline.agents || pipeline.agents.length === 0) {
        throw new Error(`Pipeline "${pipeline.id}" must have at least one agent`);
      }
      
      // Validate agent count
      validatePipelineAgentCount(pipeline.agents.length);
      
      // Validate agent references (strings) or inline agent configs
      for (let i = 0; i < pipeline.agents.length; i++) {
        const agentRef = pipeline.agents[i];
        if (typeof agentRef === 'string') {
          // Validate agent ID format
          validateId(agentRef, `Agent ID in pipeline "${pipeline.id}"`);
        } else {
          // Inline agent config - validate it
          if (!agentRef.id) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent at index ${i} without an id`);
          }
          // Validate inline agent ID format
          validateId(agentRef.id, `Inline agent ID in pipeline "${pipeline.id}"`);
          if (!agentRef.systemMessage) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a systemMessage`);
          }
          if (!agentRef.platform) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a platform`);
          }
          if (!agentRef.model) {
            throw new Error(`Pipeline "${pipeline.id}" has inline agent "${agentRef.id}" without a model`);
          }
        }
      }
    }
  }
}

/**
 * Extract intents from config
 */
export function extractIntents(config: FrameworkConfig): Intent[] {
  return config.intents || [];
}

/**
 * Extract agents from config
 * @param config - Framework configuration
 * @param basePath - Optional base path for resolving relative prompt file paths (usually config file path)
 */
export function extractAgents(config: FrameworkConfig, basePath?: string): AgentConfig[] {
  const agents = config.agents || [];
  
  // If basePath is provided, resolve prompt file paths
  if (basePath && agents.length > 0) {
    return agents.map(agent => ({
      ...agent,
      systemMessage: loadPromptFile(agent.systemMessage, basePath),
    }));
  }
  
  return agents;
}

/**
 * Extract tools from config (without execute functions)
 */
export function extractTools(config: FrameworkConfig): Omit<Tool, 'execute'>[] {
  return config.tools || [];
}

/**
 * Extract pipelines from config
 * @param config - Framework configuration
 * @param basePath - Optional base path for resolving relative prompt file paths (usually config file path)
 */
export function extractPipelines(config: FrameworkConfig, basePath?: string): PipelineConfig[] {
  const pipelines = config.pipelines || [];
  
  // If basePath is provided, resolve prompt file paths in inline agent configs
  if (basePath && pipelines.length > 0) {
    return pipelines.map(pipeline => ({
      ...pipeline,
      agents: pipeline.agents.map(agentRef => {
        if (typeof agentRef === 'string') {
          // String reference - return as is
          return agentRef;
        } else {
          // Inline agent config - resolve systemMessage path if it's a file path
          return {
            ...agentRef,
            systemMessage: loadPromptFile(agentRef.systemMessage, basePath),
          };
        }
      }),
    }));
  }
  
  return pipelines;
}


