import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Effect, Ref } from 'effect';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import { ToolRegistryService } from '../../../../packages/core/src/tool/service';
import type { MCPServerRegistry } from '../../../../packages/core/src/mcp/registry';
import type { Tool } from '../../../../packages/core/src/tool/tool';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import type { ProviderDefinition } from '../../../../packages/core/src/platform/provider';
import type {
  ToolGateServiceApi,
  ToolGateContext,
  ToolGateDecision,
  ToolGateFilterResult,
} from '../../../../packages/core/src/tool-gate/types';
import * as Schema from 'effect/Schema';

describe('ToolGateService - MCP Tool Gating', () => {
  let factory: AgentFactory;
  let toolRegistry: ToolRegistry;
  let mockRegistry: MCPServerRegistry;
  let mockProvider: ProviderDefinition;
  let mockToolGate: ToolGateServiceApi;

  const githubTools: Tool[] = [
    {
      id: 'github/create_issue',
      name: 'github/create_issue',
      description: 'Create a GitHub issue',
      schema: {
        input: Schema.Struct({
          title: Schema.String,
          body: Schema.String,
        }),
        success: Schema.String,
        failure: Schema.Never,
      },
      execute: async () => 'issue-123',
    },
    {
      id: 'github/delete_repo',
      name: 'github/delete_repo',
      description: 'Delete a GitHub repo (dangerous)',
      capabilities: ['destructive'],
      schema: {
        input: Schema.Struct({
          repo: Schema.String,
        }),
        success: Schema.String,
        failure: Schema.Never,
      },
      execute: async () => 'deleted',
    },
  ];

  const nativeTool: Tool = {
    id: 'calculator',
    name: 'calculator',
    description: 'Calculate expressions',
    schema: {
      input: Schema.Struct({
        expression: Schema.String,
      }),
      success: Schema.String,
      failure: Schema.Never,
    },
    execute: async () => '42',
  };

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    toolRegistry.registerTool(nativeTool);
    factory = new AgentFactory(toolRegistry);

    // Mock ProviderDefinition
    mockProvider = {
      id: 'test-provider',
      aliases: [],
      getModel: mock(() =>
        Effect.succeed({
          name: 'test-model',
          provider: 'test-provider',
        } as any)
      ),
      layer: {} as any,
    };

    // Mock MCPServerRegistry
    mockRegistry = {
      discoverTools: mock((serverId: string) => {
        if (serverId === 'github') {
          return Effect.succeed(githubTools);
        }
        return Effect.fail(new Error(`MCP server '${serverId}' not found`));
      }),
    } as any;

    factory.setMCPServerRegistry(mockRegistry);
  });

  afterEach(() => {
    mock.restore();
  });

  it('should deny MCP tool via policy and exclude from agent tools', async () => {
    // Mock ToolGateService that denies github/delete_repo
    mockToolGate = {
      filterTools: mock((tools: Tool[], context: ToolGateContext) => {
        const allowed = tools.filter((t) => t.id !== 'github/delete_repo');
        const denied: ToolGateDecision[] = tools
          .filter((t) => t.id === 'github/delete_repo')
          .map((t) => ({
            toolId: t.id,
            allowed: false,
            requireApproval: false,
            matchedRules: [
              {
                scope: 'default' as const,
                source: 'default',
                effect: 'deny' as const,
              },
            ],
            deniedBy: {
              scope: 'default' as const,
              source: 'default',
              effect: 'deny' as const,
            },
          }));

        const result: ToolGateFilterResult = { allowed, denied };
        return Effect.succeed(result);
      }),
      evaluateTool: mock(),
      evaluateToolById: mock(),
      getAllowedTools: mock(),
      setPolicies: mock(),
      reloadPolicies: mock(),
      getPolicies: mock(),
      hasApproval: mock(),
      recordApproval: mock(),
      clearApprovals: mock(),
      createApprovalRequest: mock(),
    };

    factory.setToolGateService(mockToolGate);

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    await factory.createAgent(config, mockProvider);

    // ToolGateService should have been called with MCP tools
    expect(mockToolGate.filterTools).toHaveBeenCalled();

    // Verify only allowed tools were registered
    expect(toolRegistry.hasTool('github/create_issue')).toBe(true);
    expect(toolRegistry.hasTool('github/delete_repo')).toBe(false);
  });

  it('should allow MCP tool via policy and include in agent tools', async () => {
    // Mock ToolGateService that allows all tools
    mockToolGate = {
      filterTools: mock((tools: Tool[]) => {
        const result: ToolGateFilterResult = {
          allowed: tools,
          denied: [],
        };
        return Effect.succeed(result);
      }),
      evaluateTool: mock(),
      evaluateToolById: mock(),
      getAllowedTools: mock(),
      setPolicies: mock(),
      reloadPolicies: mock(),
      getPolicies: mock(),
      hasApproval: mock(),
      recordApproval: mock(),
      clearApprovals: mock(),
      createApprovalRequest: mock(),
    };

    factory.setToolGateService(mockToolGate);

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    await factory.createAgent(config, mockProvider);

    // All tools should be registered
    expect(toolRegistry.hasTool('github/create_issue')).toBe(true);
    expect(toolRegistry.hasTool('github/delete_repo')).toBe(true);
  });

  it('should handle mix of native and MCP tools with some MCP denied', async () => {
    // Mock ToolGateService that denies github/delete_repo but allows others
    mockToolGate = {
      filterTools: mock((tools: Tool[]) => {
        const allowed = tools.filter((t) => t.id !== 'github/delete_repo');
        const denied: ToolGateDecision[] = tools
          .filter((t) => t.id === 'github/delete_repo')
          .map((t) => ({
            toolId: t.id,
            allowed: false,
            requireApproval: false,
            matchedRules: [],
            deniedBy: {
              scope: 'default' as const,
              source: 'default',
              effect: 'deny' as const,
            },
          }));

        return Effect.succeed({ allowed, denied });
      }),
      evaluateTool: mock(),
      evaluateToolById: mock(),
      getAllowedTools: mock(),
      setPolicies: mock(),
      reloadPolicies: mock(),
      getPolicies: mock(),
      hasApproval: mock(),
      recordApproval: mock(),
      clearApprovals: mock(),
      createApprovalRequest: mock(),
    };

    factory.setToolGateService(mockToolGate);

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      tools: ['calculator'], // Native tool
      mcpServers: ['github'], // MCP tools
    };

    await factory.createAgent(config, mockProvider);

    // Native tool should be unaffected
    expect(toolRegistry.hasTool('calculator')).toBe(true);

    // MCP tools: allowed one present, denied one absent
    expect(toolRegistry.hasTool('github/create_issue')).toBe(true);
    expect(toolRegistry.hasTool('github/delete_repo')).toBe(false);
  });

  it('should include MCP server context in gate evaluation', async () => {
    let capturedContext: ToolGateContext | undefined;

    mockToolGate = {
      filterTools: mock((tools: Tool[], context: ToolGateContext) => {
        capturedContext = context;
        return Effect.succeed({ allowed: tools, denied: [] });
      }),
      evaluateTool: mock(),
      evaluateToolById: mock(),
      getAllowedTools: mock(),
      setPolicies: mock(),
      reloadPolicies: mock(),
      getPolicies: mock(),
      hasApproval: mock(),
      recordApproval: mock(),
      clearApprovals: mock(),
      createApprovalRequest: mock(),
    };

    factory.setToolGateService(mockToolGate);

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    await factory.createAgent(config, mockProvider);

    // Verify context includes agent ID
    expect(capturedContext).toBeDefined();
    expect(capturedContext?.agentId).toBe('test-agent');
  });

  it('should log warning when MCP tools denied by policy', async () => {
    const warnMock = mock();
    const originalWarn = console.warn;
    console.warn = warnMock;

    mockToolGate = {
      filterTools: mock((tools: Tool[]) => {
        const allowed = tools.filter((t) => t.id !== 'github/delete_repo');
        const denied: ToolGateDecision[] = tools
          .filter((t) => t.id === 'github/delete_repo')
          .map((t) => ({
            toolId: t.id,
            allowed: false,
            requireApproval: false,
            matchedRules: [],
          }));

        return Effect.succeed({ allowed, denied });
      }),
      evaluateTool: mock(),
      evaluateToolById: mock(),
      getAllowedTools: mock(),
      setPolicies: mock(),
      reloadPolicies: mock(),
      getPolicies: mock(),
      hasApproval: mock(),
      recordApproval: mock(),
      clearApprovals: mock(),
      createApprovalRequest: mock(),
    };

    factory.setToolGateService(mockToolGate);

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    await factory.createAgent(config, mockProvider);

    // Should log warning for denied tools
    expect(warnMock).toHaveBeenCalled();
    const warningCall = warnMock.mock.calls.find((call) =>
      call[0].includes('MCP tools denied by policy')
    );
    expect(warningCall).toBeDefined();
    expect(warningCall[1]).toContain('github/delete_repo');

    console.warn = originalWarn;
  });
});
