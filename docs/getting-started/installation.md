# Installation

Fred is built for the Bun runtime and uses the Vercel AI SDK. Follow these steps to get started.

## Prerequisites

- **Bun**: Version 1.0 or higher ([Install Bun](https://bun.sh))
- **Node.js**: Optional, if using npm instead of Bun
- **Flox**: Optional, for consistent development environments ([Install Flox](https://flox.dev))
- **API Keys**: At least one AI provider API key (OpenAI, Groq, etc.)

## Development Environment Setup

### Using Flox (Recommended for Contributors)

Flox provides a consistent, reproducible development environment. If you're contributing to Fred or want a standardized setup:

```bash
# Activate the Flox development environment
flox activate
```

This automatically provides:
- Bun (latest version)
- Essential development tools
- Consistent environment across all machines

See the [Flox Integration Guide](../advanced/flox-integration.md) for more details.

### Manual Setup

If you prefer not to use Flox, install Bun directly from [bun.sh](https://bun.sh).

## Install Fred

### Using create-fred (Recommended)

The easiest way to get started is using `create-fred`, which sets up a complete project with all dependencies:

```bash
bunx create-fred my-project
```

This will:
- Create a new Fred project
- Automatically install all dependencies
- Set up the embedded `fred` CLI
- Include example code and configuration

See the [Quick Start Guide](quick-start.md) for next steps.

### Manual Installation

If you prefer to install Fred in an existing project:

#### Using Bun

```bash
bun add fred
```

#### Using npm

```bash
npm install fred
```

#### Using yarn

```bash
yarn add fred
```

## Install Provider Packages

Fred supports all @ai-sdk providers. Install the ones you need:

### Using the Embedded CLI (Recommended)

If you created your project with `create-fred`, use the embedded CLI:

```bash
fred provider add openai
fred provider add groq
fred provider add anthropic
```

This automatically installs the package and updates your configuration.

### Manual Installation

```bash
# OpenAI
bun add @ai-sdk/openai

# Groq
bun add @ai-sdk/groq

# Anthropic
bun add @ai-sdk/anthropic

# Google
bun add @ai-sdk/google

# Or install multiple at once
bun add @ai-sdk/openai @ai-sdk/groq @ai-sdk/anthropic
```

## Verify Installation

Create a simple test file to verify everything works:

```typescript
import { Fred } from 'fred';

const fred = new Fred();
console.log('Fred installed successfully!');
```

Run it:

```bash
bun run test.ts
```

## Environment Variables

Set your API keys as environment variables. Fred automatically detects available providers from environment variables.

### Complete List of API Key Environment Variables

Create a `.env` file in your project root with the API keys for the providers you want to use:

```env
# Core Providers
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key

# Fast & Cost-Effective Providers
GROQ_API_KEY=your_groq_key
MISTRAL_API_KEY=your_mistral_key
DEEPSEEK_API_KEY=your_deepseek_key

# Additional Providers
COHERE_API_KEY=your_cohere_key
FIREWORKS_API_KEY=your_fireworks_key
XAI_API_KEY=your_xai_key
PERPLEXITY_API_KEY=your_perplexity_key
REPLICATE_API_KEY=your_replicate_key
TOGETHER_API_KEY=your_together_key
CEREBRAS_API_KEY=your_cerebras_key
DEEPINFRA_API_KEY=your_deepinfra_key
BASETEN_API_KEY=your_baseten_key

# Voice & Specialized
ELEVENLABS_API_KEY=your_elevenlabs_key

# Cloud Services
# Azure OpenAI/Anthropic (use @ai-sdk/azure)
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint

# AWS Bedrock
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_aws_region

# Vercel AI Gateway (optional)
AI_GATEWAY_API_KEY=your_vercel_gateway_key
VERCEL_API_KEY=your_vercel_key

# Local/Community Providers
# Ollama (typically doesn't require API key, uses baseURL)
# OLLAMA_BASE_URL=http://localhost:11434
```

**Note**: 
- You only need to add the API keys for the providers you want to use
- Make sure `.env` is in your `.gitignore` to avoid committing secrets
- Dev-chat automatically detects available providers from environment variables
- Some providers (Azure, AWS Bedrock) require additional configuration

## Next Steps

- Read the [Quick Start Guide](quick-start.md)
- Learn about [Configuration](configuration.md)
- Use the [Embedded CLI](../guides/cli.md) to manage your project

