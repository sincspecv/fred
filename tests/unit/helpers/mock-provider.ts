import { AIProvider } from '../../../src/core/platform/provider';

/**
 * Create a mock AI provider for testing
 */
export function createMockProvider(): AIProvider {
  return {
    // Return a mock model object
    // The actual structure depends on AI SDK, but we just need it to be truthy
    model: {} as any,
  };
}

/**
 * Create a mock provider that can be used with AgentFactory
 * This provides a minimal implementation that won't cause errors
 */
export function createMockAIProvider(): AIProvider {
  return createMockProvider();
}
