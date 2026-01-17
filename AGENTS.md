# AI Agent Instructions for Fred Repository

This document provides guidelines and instructions for AI agents working on the Fred framework codebase.

## Core Principles

### 1. Always Leverage AI SDK

**CRITICAL**: When implementing features that interact with AI models or tools, always use the Vercel AI SDK (`ai` package) rather than creating custom implementations.

#### AI SDK Usage Patterns

- **Tool Creation**: Use `tool()` and `jsonSchema()` from `ai` package
  ```typescript
  import { tool, jsonSchema } from 'ai';
  
  const aiSdkTool = tool({
    description: toolDef.description,
    parameters: jsonSchema(toolDef.parameters),
    execute: toolDef.execute,
  });
  ```

- **Text Generation**: Use `generateText()` from `ai` package
  ```typescript
  import { generateText } from 'ai';
  
  const result = await generateText({
    model,
    system: systemMessage,
    messages: allMessages,
    tools: sdkTools,
  });
  ```

- **Message Format**: Use `ModelMessage` type from `ai` package
  ```typescript
  import { ModelMessage } from 'ai';
  ```

- **Provider Integration**: Use `@ai-sdk/*` packages for provider support
  - Never create custom provider implementations
  - Always use existing `@ai-sdk` packages
  - Follow the pattern in `src/core/platform/`

#### When NOT to Use AI SDK

- File I/O operations
- Configuration parsing
- HTTP server setup (use standard Node.js/Bun APIs)
- Database operations
- Utility functions unrelated to AI

### 2. Branch Management

**ALWAYS create a new branch** when:
- Working through a plan or to-do list
- Implementing a new feature
- Fixing a bug
- Making any code changes

#### Branch Naming Convention

- Feature branches: `feature/description-of-feature`
- Bug fixes: `fix/description-of-bug`
- Documentation: `docs/description-of-changes`
- Examples: `example/description-of-example`

#### Branch Workflow

```bash
# 1. Create and switch to new branch
git checkout -b feature/my-feature

# 2. Make changes and commit
git add .
git commit -m "Description of changes"

# 3. Push branch (when ready)
git push -u origin feature/my-feature
```

**Never commit directly to `main` branch** unless explicitly instructed.

### 3. Code Style and Patterns

#### TypeScript Best Practices

- Use TypeScript interfaces for all data structures
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public functions
- Leverage type inference for internal functions

#### File Organization

- Core functionality: `src/core/`
- Configuration: `src/config/`
- Server/API: `src/server/`
- Utilities: `src/utils/`
- Examples: `examples/`
- Documentation: `docs/`

#### Import Patterns

```typescript
// External packages first
import { tool, jsonSchema, generateText } from 'ai';
import { spawn } from 'child_process';

// Internal modules (grouped by type)
import { AgentConfig, AgentInstance } from './agent';
import { ToolRegistry } from '../tool/registry';
import { loadPromptFile } from '../../utils/prompt-loader';
```

### 4. Error Handling

- Always handle errors gracefully
- Use try-catch blocks for async operations
- Log errors with context: `console.error('Context:', error)`
- Never let errors break agent creation or tool registration
- Provide meaningful error messages

#### Error Handling Pattern

```typescript
try {
  // Operation that might fail
  await someAsyncOperation();
} catch (error) {
  // Log with context
  console.error(`Failed to ${operationName}:`, error);
  // Continue gracefully or throw if critical
  if (isCritical) {
    throw error;
  }
}
```

### 5. Testing and Validation

#### Before Committing

**CRITICAL**: Always run tests before finalizing any changes:

```bash
# Run all tests (unit tests + golden trace tests)
bun test:all

# Or run only unit tests (faster)
bun test:unit
```

**All tests must pass** before committing changes. If tests fail:
- Fix the failing tests
- Ensure new functionality has appropriate test coverage
- Verify existing tests still pass

Additional checks:
- Check for linter errors: `bun run lint` (if available)
- Verify TypeScript compiles: `bun run build`
- Test examples if applicable
- Ensure no console errors in basic usage

#### Writing Tests

When adding new functionality:
- Write tests for deterministic behavior
- Use mocks for non-deterministic operations (AI calls, external APIs)
- Follow existing test patterns in `tests/unit/`
- Test edge cases and error conditions

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed testing guidelines.

#### Testing MCP Servers

- Test with real MCP servers when possible
- Handle connection failures gracefully
- Log connection status for debugging
- Don't fail agent creation if MCP server fails

### 6. Documentation Updates

When adding new features, update:

1. **README.md** - Add to features list if significant
2. **docs/guides/** - Add or update relevant guide
3. **docs/api-reference/** - Update API documentation
4. **docs/examples/** - Add examples if applicable
5. **mkdocs.yml** - Add to navigation if new doc file

#### Documentation Pattern

- Use code examples with proper syntax highlighting
- Include both programmatic and config file examples
- Show YAML configs (preferred) and JSON alternatives
- Link between related documentation

### 7. Configuration Files

#### Preferred Format

- **YAML** is the preferred format for config files
- JSON is still supported for backward compatibility
- Examples should use YAML unless demonstrating JSON

#### Config Structure

```yaml
agents:
  - id: my-agent
    systemMessage: ./prompts/my-agent.md
    platform: openai
    model: gpt-4
    mcpServers:
      - id: filesystem
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
```

### 8. Tool Integration

#### Tool Registration Pattern

```typescript
// 1. Define tool interface
interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: { /* schema */ };
  execute: (args: any) => Promise<any>;
}

// 2. Register in ToolRegistry
toolRegistry.registerTool(tool);

// 3. Convert to AI SDK format when creating agent
const sdkTool = tool({
  description: tool.description,
  parameters: jsonSchema(tool.parameters),
  execute: tool.execute,
});
```

### 9. Agent Creation Pattern

```typescript
// Always use this pattern in factory.ts
const sdkTools: Record<string, any> = {};
for (const toolDef of tools) {
  sdkTools[toolDef.id] = tool({
    description: toolDef.description,
    parameters: jsonSchema(toolDef.parameters),
    execute: toolDef.execute,
  });
}

// Use with generateText
const result = await generateText({
  model,
  system: systemMessage,
  messages: allMessages,
  tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
});
```

### 10. MCP Server Integration

When working with MCP servers:

- Always convert MCP tools to AI SDK tools using `tool()` and `jsonSchema()`
- Handle connection failures gracefully
- Log MCP operations for debugging
- Support both stdio and HTTP transports
- Handle server requests (like `roots/list`) properly

#### MCP Tool Conversion Pattern

```typescript
import { tool, jsonSchema } from 'ai';

// Convert MCP tool to AI SDK tool
const aiSdkTool = tool({
  description: mcpTool.description,
  parameters: jsonSchema(mcpTool.inputSchema),
  execute: async (args) => {
    return await mcpClient.callTool(mcpTool.name, args);
  },
});
```

### 11. Git Workflow Best Practices

#### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb: "Add", "Fix", "Update", "Remove"
- Reference issues/PRs if applicable
- Keep first line under 72 characters

Examples:
- `Add MCP server integration support`
- `Fix tool registration conflict handling`
- `Update documentation for agent utterances`

#### Before Pushing

- **Run all tests**: `bun test:all` (must pass)
- Ensure all changes are committed
- Check git status: `git status`
- Review diff: `git diff`
- Test locally if possible

### 12. Common Patterns to Follow

#### System Message Loading

```typescript
import { loadPromptFile } from '../../utils/prompt-loader';

// Supports both file paths and string content
const systemMessage = loadPromptFile(config.systemMessage);
```

#### Provider Registration

```typescript
// Use existing provider system
await fred.useProvider('openai', { apiKey: 'key' });

// Or register default providers
fred.registerDefaultProviders();
```

#### Intent Matching

- Agent utterances take priority over intents
- Use semantic matching for flexible routing
- Always provide a default agent

### 13. Things to Avoid

❌ **Don't**:
- Create custom AI SDK implementations
- Commit directly to `main` branch
- Skip error handling
- Hardcode API keys or secrets
- Break backward compatibility without good reason
- Use `any` type unnecessarily
- Create duplicate functionality

✅ **Do**:
- Use AI SDK functions (`tool`, `jsonSchema`, `generateText`)
- Create feature branches
- Handle all error cases
- Use environment variables for secrets
- Maintain backward compatibility
- Use proper TypeScript types
- Reuse existing utilities

### 14. Quick Reference

#### Key Files

- `src/index.ts` - Main Fred class
- `src/core/agent/factory.ts` - Agent creation (uses AI SDK)
- `src/core/tool/registry.ts` - Tool management
- `src/core/mcp/` - MCP server integration
- `src/config/loader.ts` - Config file loading

#### Key Imports

```typescript
// AI SDK
import { tool, jsonSchema, generateText, ModelMessage } from 'ai';

// Fred Core
import { AgentConfig, AgentInstance } from './agent';
import { ToolRegistry } from '../tool/registry';
import { AIProvider } from '../platform/provider';
```

#### Common Commands

```bash
# Build
bun run build

# Run all tests (REQUIRED before committing)
bun test:all

# Run only unit tests
bun test:unit

# Run examples
bun run examples/basic/index.ts

# Start dev server
bun run dev

# Start production server
bun run server
```

### 15. Getting Help

When stuck:

1. Check existing code patterns in similar files
2. Review AI SDK documentation: https://sdk.vercel.ai/docs
3. Check MCP protocol spec if working with MCP
4. Look at examples in `examples/` directory
5. Review related documentation in `docs/`

---

## Summary Checklist

Before completing any task:

- [ ] Created a new branch
- [ ] Used AI SDK functions where applicable
- [ ] Handled errors gracefully
- [ ] Updated documentation if needed
- [ ] **Ran all tests: `bun test:all` (all tests must pass)**
- [ ] Added tests for new functionality (if applicable)
- [ ] Tested basic functionality
- [ ] Checked for linter errors
- [ ] Verified TypeScript compiles: `bun run build`
- [ ] Followed existing code patterns
- [ ] Used proper TypeScript types
- [ ] Committed with descriptive message

---

**Remember**: The goal is to maintain code quality, consistency, and leverage the AI SDK wherever possible. When in doubt, follow existing patterns in the codebase.
