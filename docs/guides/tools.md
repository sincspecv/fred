# Tools

Tools extend agent capabilities by providing functions they can call. Tools are reusable and can be assigned to multiple agents.

## Tool Structure

```typescript
interface Tool {
  id: string;                    // Unique identifier
  name: string;                  // Tool name
  description: string;           // Description for the AI
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  execute: (args: Record<string, any>) => Promise<any> | any;
  strict?: boolean;              // Enable strict validation (AI SDK v6) - only defined properties allowed
}
```

## Built-in Tools

Fred includes production-ready tools that you can use immediately without writing any code.

### Calculator Tool

The calculator tool provides safe arithmetic evaluation for agents. It's perfect for mathematical operations and can handle complex expressions.

**Features:**
- Basic arithmetic: `+`, `-`, `*`, `/`
- Parentheses for grouping
- Decimal and negative numbers
- Input validation and security
- Division by zero detection
- Safe evaluation (no code injection)

**Import and Registration:**

```typescript
import { Fred } from 'fred';
import { createCalculatorTool } from 'fred';

const fred = new Fred();

// Register the calculator
fred.registerTool(createCalculatorTool());

// Assign to agent
await fred.createAgent({
  id: 'assistant',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
});
```

**Agent usage:**

```
User: What is (15 + 25) * 2?
Agent: [Calls calculator tool with expression "(15 + 25) * 2"]
Agent: The result is 80.

User: Calculate 123.45 / 6.7
Agent: [Calls calculator tool]
Agent: The result is approximately 18.425.
```

**Expression Format:**

The calculator accepts a single expression string containing:
- Numbers (integers and decimals)
- Operators: `+`, `-`, `*`, `/`
- Parentheses for grouping: `(`, `)`
- Negative numbers (e.g., `-5 + 10`)

```typescript
// Valid expressions:
"2 + 3"
"(10 - 5) * 2"
"123.45 / 6.7"
"-5 + 10"
"(100 / 4) + (50 * 2)"
```

## Tool Schema Formats

Fred supports two schema formats for defining tool inputs. The Effect Schema format is recommended for new tools.

### Effect Schema Format (Recommended)

New tools should use Effect Schema for better type safety and integration:

```typescript
import { Schema } from 'effect';
import { Tool } from 'fred';

const myTool: Tool = {
  id: 'my-tool',
  name: 'my-tool',
  description: 'Description for the AI',
  schema: {
    input: Schema.Struct({
      param1: Schema.String,
      param2: Schema.Number,
      param3: Schema.optional(Schema.Boolean),
    }),
    success: Schema.String,
    metadata: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'First parameter' },
        param2: { type: 'number', description: 'Second parameter' },
        param3: { type: 'boolean', description: 'Optional third parameter' },
      },
      required: ['param1', 'param2'],
    },
  },
  execute: async (args) => {
    const { param1, param2, param3 } = args;
    // Implementation
    return 'Result';
  },
};
```

The Effect Schema format uses:
- `input`: Effect Schema definition for type validation
- `success`: Effect Schema for return type
- `metadata`: JSON Schema for AI provider compatibility

**Built-in tools (like calculator) use this format.**

### Legacy Parameters Format

The older "parameters" format is still supported for backward compatibility:

```typescript
const myTool: Tool = {
  id: 'my-tool',
  name: 'my-tool',
  description: 'Description for the AI',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'First parameter' },
      param2: { type: 'number', description: 'Second parameter' },
    },
    required: ['param1', 'param2'],
  },
  execute: async (args) => {
    // Implementation
    return 'Result';
  },
};
```

Use this format when:
- Working with legacy tools
- You don't need Effect's type system benefits
- Keeping things simple for basic tools

**Recommendation:** Use Effect Schema format for new tools to benefit from better type safety and consistency with Fred's architecture.

## Creating Tools

### Basic Tool

```typescript
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic operations',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'The operation to perform',
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

### Tool with Complex Parameters

```typescript
fred.registerTool({
  id: 'weather',
  name: 'weather',
  description: 'Get weather information for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location',
      },
      units: {
        type: 'string',
        description: 'Temperature units',
        enum: ['celsius', 'fahrenheit'],
      },
      date: {
        type: 'string',
        description: 'Date for weather forecast (YYYY-MM-DD)',
      },
    },
    required: ['location'],
  },
  execute: async (args) => {
    // Fetch weather data
    const { location, units = 'celsius', date } = args;
    // ... implementation
    return weatherData;
  },
});
```

## Tool Parameters

### String Parameters

```typescript
properties: {
  name: {
    type: 'string',
    description: 'Person name',
  },
}
```

### Number Parameters

```typescript
properties: {
  count: {
    type: 'number',
    description: 'Number of items',
  },
}
```

### Boolean Parameters

```typescript
properties: {
  enabled: {
    type: 'boolean',
    description: 'Enable feature',
  },
}
```

### Enum Parameters

```typescript
properties: {
  status: {
    type: 'string',
    description: 'Status value',
    enum: ['active', 'inactive', 'pending'],
  },
}
```

### Object Parameters

```typescript
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
}
```

### Array Parameters

```typescript
properties: {
  items: {
    type: 'array',
    description: 'List of items',
    items: {
      type: 'string',
    },
  },
}
```

## Assigning Tools to Agents

```typescript
// Register tools
fred.registerTool({ id: 'calculator', /* ... */ });
fred.registerTool({ id: 'weather', /* ... */ });

// Create agent with tools
await fred.createAgent({
  id: 'assistant',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator', 'weather'],  // Assign multiple tools
});
```

## Tool Execution

Tools are automatically called by agents when needed:

```typescript
const response = await fred.processMessage('What is 15 * 27?');

// Agent automatically calls calculator tool
console.log(response.content);  // "The result is 405"
console.log(response.toolCalls); // [{ toolId: 'calculator', args: {...}, result: 405 }]
```

## Async Tools

Tools can be async for API calls or database operations:

```typescript
fred.registerTool({
  id: 'fetch-data',
  name: 'fetch-data',
  description: 'Fetch data from an API',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'API URL' },
    },
    required: ['url'],
  },
  execute: async (args) => {
    const response = await fetch(args.url);
    return await response.json();
  },
});
```

## Error Handling

Handle errors in tool execution:

```typescript
fred.registerTool({
  id: 'safe-divide',
  name: 'safe-divide',
  description: 'Divide two numbers safely',
  parameters: {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
  },
  execute: async (args) => {
    try {
      if (args.b === 0) {
        throw new Error('Division by zero');
      }
      return args.a / args.b;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  },
});
```

## Strict Validation

AI SDK v6 supports strict validation mode for tools. When `strict: true` is set, only properties defined in the schema are allowed. Extra properties will be rejected.

```typescript
fred.registerTool({
  id: 'secure-api',
  name: 'secure-api',
  description: 'Secure API call with strict validation',
  parameters: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'API endpoint' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
    },
    required: ['endpoint', 'method'],
  },
  strict: true, // Reject any extra properties not in schema
  execute: async (args) => {
    // Only endpoint and method will be present
    return await fetch(args.endpoint, { method: args.method });
  },
});
```

**When to use strict mode:**
- Security-sensitive tools that should reject unexpected inputs
- Tools where extra properties could cause issues
- When you want explicit validation of all inputs

**Default behavior (strict: false or omitted):**
- Permissive validation - extra properties are allowed
- More flexible for tools that can handle additional parameters
- Recommended for most use cases

## Best Practices

1. **Clear Descriptions**: Write clear descriptions so the AI understands when to use the tool
2. **Required Parameters**: Mark essential parameters as required
3. **Type Safety**: Use proper types for parameters
4. **Error Handling**: Always handle errors gracefully
5. **Reusability**: Design tools to be reusable across multiple agents
6. **Strict Validation**: Use `strict: true` for security-sensitive tools that must reject unexpected inputs

## Examples

### Database Query Tool

```typescript
fred.registerTool({
  id: 'query-db',
  name: 'query-db',
  description: 'Query the database',
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Table name' },
      where: { type: 'object', description: 'Where conditions' },
      limit: { type: 'number', description: 'Result limit' },
    },
    required: ['table'],
  },
  execute: async (args) => {
    // Database query implementation
    return results;
  },
});
```

### File Operations Tool

```typescript
fred.registerTool({
  id: 'read-file',
  name: 'read-file',
  description: 'Read a file from the filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
    },
    required: ['path'],
  },
  execute: async (args) => {
    const file = Bun.file(args.path);
    return await file.text();
  },
});
```

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Providers](providers.md)
- Check [API Reference](../api-reference/tools.md)

