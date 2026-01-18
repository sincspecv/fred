import { AIProvider } from '../../../src/core/platform/provider';
import { LanguageModel } from 'ai';

/**
 * Create a mock AI provider for testing
 */
export function createMockProvider(platform: string = 'openai'): AIProvider {
  // Create a minimal mock model that satisfies LanguageModel interface
  const mockModel = {
    provider: platform,
    modelId: 'gpt-4',
  } as LanguageModel;

  return {
    getModel: (modelId: string) => {
      return {
        ...mockModel,
        modelId,
      } as LanguageModel;
    },
    getPlatform: () => platform,
  };
}

/**
 * Create a mock provider that can be used with AgentFactory
 * This provides a minimal implementation that won't cause errors
 */
export function createMockAIProvider(platform?: string): AIProvider {
  return createMockProvider(platform);
}
