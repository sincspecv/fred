import { PipelineConfig, PipelineInstance, PipelineAgentRef } from './pipeline';
import { AgentManager } from '../agent/manager';
import { AgentMessage, AgentResponse } from '../agent/agent';
import { semanticMatch } from '../../utils/semantic';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import {
  validateId,
  validateMessageLength,
  validatePipelineAgentCount,
  validatePipelineMessageCount,
  validateRegexPattern,
} from '../../utils/validation';

/**
 * Pipeline manager for lifecycle management
 */
export class PipelineManager {
  private pipelines: Map<string, PipelineInstance> = new Map();
  private agentManager: AgentManager;
  private tracer?: Tracer;

  constructor(agentManager: AgentManager, tracer?: Tracer) {
    this.agentManager = agentManager;
    this.tracer = tracer;
  }

  /**
   * Set the tracer for pipeline operations
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
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
    previousMessages: AgentMessage[] = []
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
          const response = await agent.processMessage(currentMessage, currentHistory);

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
          currentHistory.push({
            role: 'user',
            content: currentMessage,
          });
          
          // - Add this agent's response to history
          currentHistory.push({
            role: 'assistant',
            content: response.content,
          });

          // - The next agent's primary message is this agent's response
          currentMessage = response.content;

          // Validate accumulated message count after each agent
          validatePipelineMessageCount(currentHistory.length);

          // Store response (will be overwritten by next agent, final one is what we return)
          finalResponse = response;

          // If agent requests a handoff, we should handle it
          // For now, we'll continue through the pipeline
          // TODO: Consider if handoffs should break the pipeline or be handled differently
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
}
