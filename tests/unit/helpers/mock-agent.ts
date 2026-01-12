import { AgentInstance, AgentMessage, AgentResponse } from '../../../src/core/agent/agent';

/**
 * Create a mock agent instance for testing
 */
export function createMockAgent(
  id: string,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const defaultConfig = {
    id,
    systemMessage: 'You are a helpful assistant.',
    platform: 'openai',
    model: 'gpt-4',
    ...config,
  };

  return {
    id,
    config: defaultConfig as AgentInstance['config'],
    processMessage: async (message: string, previousMessages?: AgentMessage[]): Promise<AgentResponse> => {
      return {
        content: `Mock response to: ${message}`,
        toolCalls: [],
      };
    },
  };
}

/**
 * Create a mock agent that returns a specific response
 */
export function createMockAgentWithResponse(
  id: string,
  response: AgentResponse,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const agent = createMockAgent(id, config);
  agent.processMessage = async () => response;
  return agent;
}

/**
 * Create a mock agent that throws an error
 */
export function createMockAgentWithError(
  id: string,
  error: Error,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const agent = createMockAgent(id, config);
  agent.processMessage = async () => {
    throw error;
  };
  return agent;
}
