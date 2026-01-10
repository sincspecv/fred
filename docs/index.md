# Fred Documentation

Welcome to the Fred framework documentation! Fred is a flexible framework for building AI agents with intent-based routing, configurable agents with system messages and tool assignments, and support for multiple AI platforms.

## What is Fred?

Fred is a powerful framework that allows you to:

- **Build AI Agents**: Create intelligent agents with custom system messages and behaviors
- **Intent-Based Routing**: Route messages to specific agents based on user intents
- **Multi-Platform Support**: Use any AI provider supported by the Vercel AI SDK (OpenAI, Anthropic, Google, Groq, and 20+ more)
- **Tool Integration**: Assign reusable tools to agents for extended capabilities
- **Global Context**: Maintain conversation context across multiple agents seamlessly
- **OpenAI-Compatible API**: Works with standard AI chat tools like Misty, Chatbox, etc.

## Quick Start

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// Use a provider
await fred.useProvider('openai', { apiKey: 'your-key' });

// Create an agent
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
});

// Set as default agent
fred.setDefaultAgent('my-agent');

// Process messages
const response = await fred.processMessage('Hello!');
console.log(response.content);
```

## Key Features

### 🎯 Intent-Based Routing

Match user messages to intents using exact, regex, or semantic matching, then route to the appropriate agent.

### 🤖 Configurable Agents

Define agents with custom system messages, AI platform integration, and tool assignments.

### 🛠️ Tool Registry

Create reusable tools that can be shared across multiple agents.

### 🌐 Multi-Platform Support

Supports all @ai-sdk providers including OpenAI, Anthropic, Google, Groq, Mistral, Cohere, and 15+ more.

### 💬 Global Context

Maintain conversation history across all agents for seamless multi-agent conversations.

### 🔌 OpenAI-Compatible API

Standard `/v1/chat/completions` endpoint works with AI chat tools like Misty and Chatbox.

### 📝 Markdown System Prompts

Store complex system prompts in markdown files for better organization and maintainability.

### 🔄 Dynamic Agent Handoff

Agents can seamlessly transfer conversations to other agents when needed.

### 🪝 Pipeline Hooks

Intercept and modify the message processing pipeline at 12 strategic points for context injection, logging, and custom processing.

### ⚡ Embedded CLI

Built-in CLI commands for managing providers, agents, and tools - no additional packages required.

## Documentation Structure

- **[Getting Started](getting-started/installation.md)** - Installation and setup
- **[Guides](guides/agents.md)** - Step-by-step guides for using Fred
- **[API Reference](api-reference/fred-class.md)** - Complete API documentation
- **[Examples](examples/basic-usage.md)** - Code examples and tutorials
- **[Advanced](advanced/custom-providers.md)** - Advanced topics and customization

## Installation

### Quick Start with create-fred

The easiest way to get started:

```bash
bunx create-fred my-project
```

This creates a complete project with all dependencies installed and the embedded CLI ready to use.

### Manual Installation

```bash
bun add fred
```

Or with npm:

```bash
npm install fred
```

## Next Steps

- Read the [Installation Guide](getting-started/installation.md)
- Try the [Quick Start](getting-started/quick-start.md)
- Learn about the [Embedded CLI](guides/cli.md)
- Explore the [Examples](examples/basic-usage.md)

