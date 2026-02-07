import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { FrameworkConfig, MCPGlobalServerConfig } from '../../../packages/core/src/config/types';
import { extractMCPServers, validateConfig } from '../../../packages/core/src/config/loader';

describe('MCP Config - Server Extraction', () => {
  test('extracts MCP servers from config with all fields', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'test-token',
          },
          timeout: 30000,
          enabled: true,
          lazy: false,
        },
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/docs'],
          lazy: true,
        },
        'remote-api': {
          transport: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer test-token',
          },
          timeout: 60000,
          retry: {
            maxRetries: 3,
            backoffMs: 1000,
            maxBackoffMs: 4000,
          },
          healthCheckIntervalMs: 60000,
        },
      },
    };

    const servers = extractMCPServers(config);

    expect(servers).toHaveLength(3);

    const github = servers.find((s) => s.id === 'github');
    expect(github).toBeDefined();
    expect(github?.transport).toBe('stdio');
    expect(github?.command).toBe('npx');
    expect(github?.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(github?.env).toEqual({ GITHUB_TOKEN: 'test-token' });
    expect(github?.timeout).toBe(30000);
    expect(github?.enabled).toBe(true);
    expect(github?.lazy).toBe(false);

    const filesystem = servers.find((s) => s.id === 'filesystem');
    expect(filesystem).toBeDefined();
    expect(filesystem?.lazy).toBe(true);

    const remoteApi = servers.find((s) => s.id === 'remote-api');
    expect(remoteApi).toBeDefined();
    expect(remoteApi?.transport).toBe('http');
    expect(remoteApi?.url).toBe('https://api.example.com/mcp');
    expect(remoteApi?.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(remoteApi?.retry).toEqual({
      maxRetries: 3,
      backoffMs: 1000,
      maxBackoffMs: 4000,
    });
    expect(remoteApi?.healthCheckIntervalMs).toBe(60000);
  });

  test('extracts servers with defaults when optional fields omitted', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        minimal: {
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
    };

    const servers = extractMCPServers(config);

    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe('minimal');
    expect(servers[0].enabled).toBe(true); // default
    expect(servers[0].lazy).toBe(false); // default = auto-start
    expect(servers[0].timeout).toBe(30000); // default
  });

  test('returns empty array when mcpServers is undefined', () => {
    const config: FrameworkConfig = {};
    const servers = extractMCPServers(config);
    expect(servers).toEqual([]);
  });

  test('returns empty array when mcpServers is empty object', () => {
    const config: FrameworkConfig = {
      mcpServers: {},
    };
    const servers = extractMCPServers(config);
    expect(servers).toEqual([]);
  });
});

describe('MCP Config - Environment Variable Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set test env vars
    process.env.GITHUB_TOKEN = 'github-secret';
    process.env.API_KEY = 'api-secret';
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  test('resolves ${ENV_VAR} patterns in env object', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: '${GITHUB_TOKEN}',
          },
        },
      },
    };

    const servers = extractMCPServers(config);
    const github = servers.find((s) => s.id === 'github');

    expect(github?.env?.GITHUB_TOKEN).toBe('github-secret');
  });

  test('resolves ${ENV_VAR} patterns in headers', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        api: {
          transport: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer ${API_KEY}',
          },
        },
      },
    };

    const servers = extractMCPServers(config);
    const api = servers.find((s) => s.id === 'api');

    expect(api?.headers?.Authorization).toBe('Bearer api-secret');
  });

  test('resolves ${ENV_VAR} patterns in url', () => {
    process.env.MCP_HOST = 'mcp.example.com';

    const config: FrameworkConfig = {
      mcpServers: {
        api: {
          transport: 'http',
          url: 'https://${MCP_HOST}/api',
        },
      },
    };

    const servers = extractMCPServers(config);
    const api = servers.find((s) => s.id === 'api');

    expect(api?.url).toBe('https://mcp.example.com/api');
  });

  test('keeps literal ${ENV_VAR} when env var not set', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        api: {
          transport: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer ${MISSING_TOKEN}',
          },
        },
      },
    };

    // Mock console.warn to verify warning
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    const servers = extractMCPServers(config);
    const api = servers.find((s) => s.id === 'api');

    // Should keep literal value and warn
    expect(api?.headers?.Authorization).toBe('Bearer ${MISSING_TOKEN}');
    expect(warnings.some((w) => w.includes('MISSING_TOKEN'))).toBe(true);

    console.warn = originalWarn;
  });

  test('resolves multiple ${ENV_VAR} patterns in same string', () => {
    process.env.PROTOCOL = 'https';
    process.env.HOST = 'api.example.com';

    const config: FrameworkConfig = {
      mcpServers: {
        api: {
          transport: 'http',
          url: '${PROTOCOL}://${HOST}/mcp',
        },
      },
    };

    const servers = extractMCPServers(config);
    const api = servers.find((s) => s.id === 'api');

    expect(api?.url).toBe('https://api.example.com/mcp');
  });
});

describe('MCP Config - Agent Server References', () => {
  test('agent config accepts string[] for mcpServers', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
      },
      agents: [
        {
          id: 'code-agent',
          platform: 'openai',
          model: 'gpt-4',
          systemMessage: 'You are a code assistant',
          mcpServers: ['github', 'filesystem'], // string array of server IDs
        },
      ],
    };

    // Should not throw
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe('MCP Config - Validation Warnings', () => {
  test('warns when agent references unknown MCP server', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        github: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      },
      agents: [
        {
          id: 'code-agent',
          platform: 'openai',
          model: 'gpt-4',
          systemMessage: 'You are a code assistant',
          mcpServers: ['github', 'unknown-server'], // unknown-server doesn't exist
        },
      ],
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    // Should NOT throw - warn only
    expect(() => validateConfig(config)).not.toThrow();

    // Should have warned about unknown server
    expect(warnings.some((w) => w.includes('unknown-server'))).toBe(true);

    console.warn = originalWarn;
  });

  test('warns when stdio transport missing command', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        broken: {
          transport: 'stdio',
          // command missing
          args: ['server.js'],
        } as any,
      },
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    // Should NOT throw - warn only
    expect(() => validateConfig(config)).not.toThrow();

    // Should have warned about missing command
    expect(warnings.some((w) => w.includes('command') && w.includes('stdio'))).toBe(true);

    console.warn = originalWarn;
  });

  test('warns when http/sse transport missing url', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        broken: {
          transport: 'http',
          // url missing
          headers: { Authorization: 'Bearer token' },
        } as any,
      },
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    // Should NOT throw - warn only
    expect(() => validateConfig(config)).not.toThrow();

    // Should have warned about missing url
    expect(warnings.some((w) => w.includes('url') && w.includes('http'))).toBe(true);

    console.warn = originalWarn;
  });

  test('warns when sse transport missing url', () => {
    const config: FrameworkConfig = {
      mcpServers: {
        broken: {
          transport: 'sse',
          // url missing
        } as any,
      },
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    // Should NOT throw - warn only
    expect(() => validateConfig(config)).not.toThrow();

    // Should have warned about missing url
    expect(warnings.some((w) => w.includes('url') && w.includes('sse'))).toBe(true);

    console.warn = originalWarn;
  });
});
