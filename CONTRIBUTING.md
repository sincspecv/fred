# Contributing to Fred

Thank you for your interest in contributing to Fred! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (recommended) or Node.js
- [Flox](https://flox.dev/) (optional, but recommended for consistent environments)
- Git
- A code editor (VS Code, Cursor, etc.)

### Development Setup

#### Option 1: Using Flox (Recommended)

Flox provides a consistent, reproducible development environment:

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/fred.git
   cd fred
   ```

2. **Activate Flox environment**
   ```bash
   flox activate
   ```
   
   This automatically provides:
   - Bun (latest version)
   - Essential development tools
   - Consistent environment across all machines

3. **Install dependencies**
   ```bash
   bun install
   ```

4. **Build the project**
   ```bash
   bun run build
   ```

5. **Run tests** (if available)
   ```bash
   bun test
   ```

#### Option 2: Manual Setup

If you prefer not to use Flox:

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/fred.git
   cd fred
   ```

2. **Install Bun** (if not already installed)
   
   **Recommended**: Use your system's package manager or download from [bun.sh](https://bun.sh).
   
   **Manual installation** (safer than pipe-to-shell):
   ```bash
   # 1. Download the installer
   curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh
   
   # 2. Review the script contents
   cat /tmp/bun-install.sh
   
   # 3. If satisfied, execute it
   bash /tmp/bun-install.sh
   ```
   
   **Security Note**: Avoid piping downloads directly to shell (`curl | bash`). Always download, review, then execute installation scripts to prevent remote code execution risks.

3. **Install dependencies**
   ```bash
   bun install
   ```

4. **Build the project**
   ```bash
   bun run build
   ```

5. **Run tests** (if available)
   ```bash
   bun test
   ```

## Development Workflow

### 1. Create a Branch

**Always create a new branch** for your work:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
# or
git checkout -b docs/your-documentation-update
```

### 2. Make Your Changes

- Follow the coding standards outlined in [AGENTS.md](./AGENTS.md)
- Write clear, readable code
- Add comments for complex logic
- Update documentation as needed

### 3. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git commit -m "Add feature: description of what you added"
git commit -m "Fix bug: description of what you fixed"
git commit -m "Update docs: description of documentation changes"
```

### 4. Push and Create a Pull Request

```bash
git push -u origin feature/your-feature-name
```

Then create a pull request on GitHub with:
- A clear title and description
- Reference to any related issues
- Screenshots or examples if applicable

## Coding Standards

### Always Use AI SDK

When working with AI models or tools, **always use the Vercel AI SDK**:

```typescript
import { tool, jsonSchema, generateText } from 'ai';

// ✅ Correct: Use AI SDK
const sdkTool = tool({
  description: toolDef.description,
  parameters: jsonSchema(toolDef.parameters),
  execute: toolDef.execute,
});

// ❌ Wrong: Don't create custom implementations
```

See [AGENTS.md](./AGENTS.md) for detailed AI SDK usage patterns.

### TypeScript Guidelines

- Use TypeScript interfaces for data structures
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public functions
- Avoid `any` type when possible

### File Organization

- Core functionality: `src/core/`
- Configuration: `src/config/`
- Server/API: `src/server/`
- Utilities: `src/utils/`
- Examples: `examples/`
- Documentation: `docs/`

### Error Handling

Always handle errors gracefully:

```typescript
try {
  await someOperation();
} catch (error) {
  console.error('Context:', error);
  // Handle error appropriately
}
```

## Documentation

When adding new features, update:

1. **README.md** - Add to features list if significant
2. **docs/guides/** - Add or update relevant guide
3. **docs/api-reference/** - Update API documentation
4. **docs/examples/** - Add examples if applicable
5. **mkdocs.yml** - Add to navigation if new doc file

### Documentation Style

- Use code examples with syntax highlighting
- Include both programmatic and config file examples
- Prefer YAML for config examples (JSON is also supported)
- Link between related documentation

## Testing

Fred uses Bun's built-in test framework for unit tests. The test suite focuses on deterministic functionality and uses mocks for non-deterministic operations (AI model calls, external APIs, etc.).

### Running Tests

```bash
# Run all tests (unit tests + golden trace tests)
bun test:all

# Run only unit tests
bun test:unit

# Run tests with specific pattern
bun test tests/unit/core/tool

# Run a specific test file
bun test tests/unit/core/tool/registry.test.ts
```

### Test Structure

Tests are organized in `tests/unit/` mirroring the `src/` structure:

```
tests/unit/
├── helpers/           # Mock utilities
│   ├── mock-agent.ts
│   ├── mock-provider.ts
│   ├── mock-storage.ts
│   └── mock-file-system.ts
├── core/              # Core functionality tests
│   ├── tool/
│   ├── intent/
│   ├── context/
│   ├── hooks/
│   ├── agent/
│   └── pipeline/
├── config/             # Config parsing/loading tests
└── utils/              # Utility function tests
```

### Writing Tests

When adding new functionality, write tests for deterministic behavior:

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { YourClass } from '../../../../src/path/to/your-class';

describe('YourClass', () => {
  let instance: YourClass;

  beforeEach(() => {
    instance = new YourClass();
  });

  test('should do something', () => {
    const result = instance.doSomething();
    expect(result).toBe(expectedValue);
  });
});
```

### Test Guidelines

- **Test deterministic functionality only**: Don't test AI model calls, external APIs, or file I/O (unless mocked)
- **Use mocks for non-deterministic operations**: Mock AI providers, agents, and external services
- **Follow existing patterns**: Use the same structure and naming conventions as existing tests
- **Keep tests fast**: Tests should run quickly without external dependencies
- **Test edge cases**: Include tests for error conditions, boundary values, and edge cases

### What to Test

✅ **Do test:**
- Validation logic
- Data transformations
- Routing and matching logic
- CRUD operations
- Configuration parsing
- Utility functions
- Error handling

❌ **Don't test:**
- AI model responses (non-deterministic)
- External API calls (use mocks)
- File I/O operations (unless mocked)
- Real MCP server interactions

### Before Submitting a Pull Request

- [ ] Code compiles without errors: `bun run build`
- [ ] All tests pass: `bun test:all`
- [ ] New functionality has test coverage
- [ ] No linter errors (if linter is configured)
- [ ] Tested basic functionality manually
- [ ] Updated documentation if needed
- [ ] Followed existing code patterns

## Pull Request Process

1. **Update your branch** with the latest changes from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout your-branch
   git rebase main
   ```

2. **Ensure your code follows the project standards** (see [AGENTS.md](./AGENTS.md))

3. **Write a clear PR description**:
   - What changes were made
   - Why the changes were needed
   - How to test the changes
   - Any breaking changes

4. **Wait for review** - Maintainers will review your PR

5. **Address feedback** - Make requested changes and update your PR

## Types of Contributions

### Bug Reports

When reporting bugs, please include:

- Clear description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (OS, Bun/Node version, etc.)
- Error messages or logs

### Feature Requests

When requesting features:

- Describe the use case
- Explain why it would be useful
- Provide examples if possible
- Consider implementation complexity

### Code Contributions

- Bug fixes
- New features
- Performance improvements
- Documentation updates
- Example code
- Test improvements

## AI Agent Contributors

If you're an AI agent working on this repository, please see [AGENTS.md](./AGENTS.md) for specific guidelines including:

- Always leverage AI SDK when possible
- Always create a new branch when working through plans/to-dos
- Follow existing code patterns
- Update documentation appropriately

## Questions?

- Open an issue for bug reports or feature requests
- Check existing issues and PRs before creating new ones
- Review the [documentation](https://sincspecv.github.io/fred) for usage examples

## License

By contributing to Fred, you agree that your contributions will be licensed under the MIT License (see [LICENSE.md](./LICENSE.md)).

---

Thank you for contributing to Fred! 🎉
