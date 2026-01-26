# Tools API

API reference for tool configuration and management.

## Built-in Tools

### createCalculatorTool

Creates a production-ready calculator tool for safe arithmetic evaluation.

```typescript
import { createCalculatorTool } from 'fred';

function createCalculatorTool(): Tool
```

**Returns:** A Tool object configured for arithmetic operations.

**Features:**
- Safe expression evaluation (no code injection)
- Supports: `+`, `-`, `*`, `/`, parentheses, decimals, negative numbers
- Input validation and security
- Division by zero detection

**Example:**

```typescript
import { Fred } from 'fred';
import { createCalculatorTool } from 'fred';

const fred = new Fred();
fred.registerTool(createCalculatorTool());

await fred.createAgent({
  id: 'assistant',
  tools: ['calculator'],
  // ...
});
```

**Tool Schema:**

The calculator tool uses Effect Schema format:

```typescript
{
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic operations...',
  schema: {
    input: Schema.Struct({
      expression: Schema.String,
    }),
    success: Schema.String,
    metadata: { /* ... */ }
  },
  execute: async (args) => { /* ... */ }
}
```

## Tool Interface

Fred supports two schema formats for tools:

### Effect Schema Format (Recommended)

```typescript
import { Schema } from 'effect';

interface Tool {
  id: string;                    // Unique tool identifier
  name: string;                  // Tool name
  description: string;            // Description for the AI
  schema: {
    input: Schema.Schema<any>;   // Effect Schema for input validation
    success: Schema.Schema<any>; // Effect Schema for output type
    metadata: {                  // JSON Schema for AI provider
      type: 'object';
      properties: Record<string, ToolParameter>;
      required?: string[];
    };
  };
  execute: (args: Record<string, any>) => Promise<any> | any;
  strict?: boolean;              // Enable strict validation (AI SDK v6)
}
```

### Legacy Parameters Format

```typescript
interface Tool {
  id: string;                    // Unique tool identifier
  name: string;                  // Tool name
  description: string;            // Description for the AI
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  execute: (args: Record<string, any>) => Promise<any> | any;
  strict?: boolean;              // Enable strict validation (AI SDK v6)
}
```

**Note:** Built-in tools use the Effect Schema format. For new tools, Effect Schema is recommended for better type safety.

## ToolParameter

```typescript
interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: (string | number)[];
  properties?: Record<string, ToolParameter>; // For object types
  items?: ToolParameter;                    // For array types
}
```

## Examples

### Creating a Tool

```typescript
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Operation to perform',
        enum: ['add', 'subtract', 'multiply', 'divide'],
      },
      a: {
        type: 'number',
        description: 'First number',
      },
      b: {
        type: 'number',
        description: 'Second number',
      },
    },
    required: ['operation', 'a', 'b'],
  },
  execute: async (args) => {
    const { operation, a, b } = args;
    switch (operation) {
      case 'add': return a + b;
      case 'subtract': return a - b;
      case 'multiply': return a * b;
      case 'divide': return b !== 0 ? a / b : 'Error: Division by zero';
    }
  },
});
```

### Getting a Tool

```typescript
const tool = fred.getTool('calculator');
if (tool) {
  console.log(tool.description);
}
```

### Getting All Tools

```typescript
const tools = fred.getTools();
console.log(tools); // Array of all registered tools
```

### Tool with Complex Parameters

```typescript
fred.registerTool({
  id: 'complex-tool',
  name: 'complex-tool',
  description: 'Tool with complex parameters',
  parameters: {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        description: 'User information',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      },
      tags: {
        type: 'array',
        description: 'List of tags',
        items: { type: 'string' },
      },
    },
    required: ['user'],
  },
  execute: async (args) => {
    // Implementation
  },
});
```

### Tool with Strict Validation

```typescript
fred.registerTool({
  id: 'secure-tool',
  name: 'secure-tool',
  description: 'Tool with strict validation enabled',
  parameters: {
    type: 'object',
    properties: {
      apiKey: { type: 'string', description: 'API key' },
      action: { type: 'string', description: 'Action to perform' },
    },
    required: ['apiKey', 'action'],
  },
  strict: true, // Enable strict validation - only defined properties allowed
  execute: async (args) => {
    // Only args.apiKey and args.action will be present
    // Extra properties will be rejected by AI SDK v6
    return { success: true };
  },
});
```

### Tool with Effect Schema Format

```typescript
import { Schema } from 'effect';

fred.registerTool({
  id: 'user-lookup',
  name: 'user-lookup',
  description: 'Look up user information by ID',
  schema: {
    input: Schema.Struct({
      userId: Schema.String,
      includeDetails: Schema.optional(Schema.Boolean),
    }),
    success: Schema.String,
    metadata: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID to look up' },
        includeDetails: { type: 'boolean', description: 'Include detailed information' },
      },
      required: ['userId'],
    },
  },
  execute: async (args) => {
    const { userId, includeDetails = false } = args;
    // Fetch user data
    return JSON.stringify({ userId, name: 'John Doe', /* ... */ });
  },
});
```

## Import Paths

```typescript
// Built-in tools
import { createCalculatorTool } from 'fred';

// Core types
import type { Tool, ToolParameter } from 'fred';

// Effect Schema
import { Schema } from 'effect';
```

