import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Effect } from 'effect';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import type { MCPServerRegistry } from '../../../../packages/core/src/mcp/registry';
import type { Tool } from '../../../../packages/core/src/tool/tool';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import type { ProviderDefinition } from '../../../../packages/core/src/platform/provider';
import * as Schema from 'effect/Schema';

describe('AgentFactory - MCP Registry Integration', () => {
  let factory: AgentFactory;
  let toolRegistry: ToolRegistry;
  let mockRegistry: MCPServerRegistry;
  let mockProvider: ProviderDefinition;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
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
              id: 'github/list_repos',
              name: 'github/list_repos',
              description: 'List GitHub repos',
              schema: {
                input: Schema.Struct({}),
                success: Schema.Array(Schema.String),
                failure: Schema.Never,
              },
              execute: async () => ['repo1', 'repo2'],
            },
          ];
          return Effect.succeed(githubTools);
        }
        if (serverId === 'filesystem') {
          const fsTools: Tool[] = [
            {
              id: 'filesystem/read_file',
              name: 'filesystem/read_file',
              description: 'Read a file',
              schema: {
                input: Schema.Struct({
                  path: Schema.String,
                }),
                success: Schema.String,
                failure: Schema.Never,
              },
              execute: async () => 'file contents',
            },
          ];
          return Effect.succeed(fsTools);
        }
        if (serverId === 'unknown') {
          return Effect.fail(new Error(`MCP server 'unknown' not found`));
        }
        return Effect.fail(new Error(`MCP server '${serverId}' not found`));
      }),
    } as any;

    factory.setMCPServerRegistry(mockRegistry);
  });

  afterEach(() => {
    mock.restore();
  });

  it('should discover tools from global registry when mcpServers specified', async () => {
    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    const agent = await factory.createAgent(config, mockProvider);
    expect(agent).toBeDefined();
    expect(mockRegistry.discoverTools).toHaveBeenCalledWith('github');

    // Verify tools were registered
    expect(toolRegistry.hasTool('github/create_issue')).toBe(true);
    expect(toolRegistry.hasTool('github/list_repos')).toBe(true);
  });

  it('should warn but not crash when server ID not found in registry', async () => {
    const warnMock = mock();
    const originalWarn = console.warn;
    console.warn = warnMock;

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['unknown'],
    };

    const agent = await factory.createAgent(config, mockProvider);
    expect(agent).toBeDefined();
    expect(mockRegistry.discoverTools).toHaveBeenCalledWith('unknown');
    expect(warnMock).toHaveBeenCalled();
    expect(warnMock.mock.calls[0][0]).toContain('Failed to discover tools');
    expect(warnMock.mock.calls[0][0]).toContain('unknown');

    console.warn = originalWarn;
  });

  it('should work normally when no mcpServers specified', async () => {
    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      // No mcpServers
    };

    const agent = await factory.createAgent(config, mockProvider);
    expect(agent).toBeDefined();
    expect(mockRegistry.discoverTools).not.toHaveBeenCalled();
  });

  it('should discover tools from multiple MCP servers', async () => {
    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github', 'filesystem'],
    };

    const agent = await factory.createAgent(config, mockProvider);
    expect(agent).toBeDefined();
    expect(mockRegistry.discoverTools).toHaveBeenCalledWith('github');
    expect(mockRegistry.discoverTools).toHaveBeenCalledWith('filesystem');

    // Verify tools from both servers were registered
    expect(toolRegistry.hasTool('github/create_issue')).toBe(true);
    expect(toolRegistry.hasTool('github/list_repos')).toBe(true);
    expect(toolRegistry.hasTool('filesystem/read_file')).toBe(true);
  });

  it('should use server/tool namespace format for MCP tools', async () => {
    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    await factory.createAgent(config, mockProvider);

    // Verify namespace format
    const tool = toolRegistry.getTool('github/create_issue');
    expect(tool).toBeDefined();
    expect(tool?.id).toBe('github/create_issue');
    expect(tool?.name).toBe('github/create_issue');
  });

  it('should skip MCP tool discovery when registry not set', async () => {
    // Create new factory without registry
    const factoryNoRegistry = new AgentFactory(new ToolRegistry());

    const config: AgentConfig = {
      id: 'test-agent',
      systemMessage: 'Test agent',
      platform: 'test-provider',
      model: 'test-model',
      mcpServers: ['github'],
    };

    const agent = await factoryNoRegistry.createAgent(config, mockProvider);
    expect(agent).toBeDefined();
    // discoverTools should not be called since registry not set
  });
});
