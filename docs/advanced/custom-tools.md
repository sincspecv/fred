# Custom Tools

Learn how to create advanced custom tools for Fred.

## Advanced Tool Example

```typescript
fred.registerTool({
  id: 'database-query',
  name: 'database-query',
  description: 'Query the database',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      params: { type: 'object' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    // Database query implementation
    const results = await db.query(args.query, args.params);
    return results;
  },
});
```

## Tool with Authentication

```typescript
fred.registerTool({
  id: 'authenticated-api',
  name: 'authenticated-api',
  description: 'Call authenticated API',
  parameters: {
    type: 'object',
    properties: {
      endpoint: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
    },
    required: ['endpoint'],
  },
  execute: async (args) => {
    const response = await fetch(args.endpoint, {
      method: args.method || 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`,
      },
    });
    return await response.json();
  },
});
```

## Tool with Strict Validation

For security-sensitive tools, enable strict validation to reject unexpected properties:

```typescript
fred.registerTool({
  id: 'secure-api',
  name: 'secure-api',
  description: 'Secure API call with strict validation',
  parameters: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'API endpoint' },
      method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method' },
    },
    required: ['endpoint', 'method'],
  },
  strict: true, // Only defined properties allowed - extra properties rejected
  execute: async (args) => {
    // Only endpoint and method will be present
    // Extra properties will be rejected by AI SDK v6
    const response = await fetch(args.endpoint, {
      method: args.method,
      headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`,
      },
    });
    return await response.json();
  },
});
```

**When to use `strict: true`:**
- Security-sensitive tools that must reject unexpected inputs
- Tools where extra properties could cause issues
- When you want explicit validation of all inputs

**Default behavior (`strict: false` or omitted):**
- Permissive validation - extra properties are allowed
- More flexible for tools that can handle additional parameters
- Recommended for most use cases

