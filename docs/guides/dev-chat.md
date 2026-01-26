# Development Chat

Fred includes a development chat interface for quickly testing agents and intents during development. **No configuration required** - dev-chat works out of the box!

## Starting Dev Chat

```bash
bun run dev
```

This starts an interactive terminal chat interface with hot reload. Dev-chat automatically:
- Detects available AI providers from environment variables
- Creates a temporary dev agent if no agents are configured
- Prompts to install missing provider packages if needed
- Works immediately without any setup

## Features

### Zero-Config Setup

Dev-chat works immediately without any configuration:

- **Auto-Detection**: Automatically detects available AI providers from environment variables
- **Auto-Installation**: Prompts to install missing provider packages (e.g., `@ai-sdk/groq`)
- **Auto-Agent Creation**: Creates a temporary dev agent if no agents are configured
- **Built-in Calculator Tool**: Temporary dev agent includes calculator for testing mathematical operations
- **No Setup Required**: Just set an API key environment variable and run `bun run dev`

Example:
```bash
# Set an API key
export GROQ_API_KEY=your_key_here

# Run dev-chat (works immediately!)
bun run dev
```

If the required provider package isn't installed, dev-chat will prompt you to install it.

### Hot Reload

The dev chat automatically reloads when you change code:

```
💬 Fred Dev Chat (Conversation ID: conv_1234567890_abc123)
Type your messages and press Enter. Type "exit" or "quit" to stop.
💡 Tip: Code changes will automatically reload Fred while preserving context!

> Hello!

🤖 Hello! How can I help you today?

[You edit your agent code...]

🔄 Reloading Fred...
✅ Loaded config from /path/to/config.json
✅ Preserved conversation context (2 messages)
✅ Fred reloaded successfully!

> What did I just say?

🤖 You said "Hello!" earlier in our conversation.
```

### Context Preservation

Conversation context is maintained across reloads, so you can continue testing without losing conversation history.

### Auto-Config Loading

The dev chat automatically loads config files if they exist:

- `config.json`
- `fred.config.json`
- `config.yaml`
- `fred.config.yaml`

## Commands

### exit / quit

Exit the chat interface:

```
> exit
👋 Goodbye!
```

### clear / /clear

Clear conversation context and start fresh:

```
> clear
🧹 Conversation cleared. New conversation started.
```

### help / /help

Show available commands:

```
> help
📖 Commands:
  exit, quit  - Exit the chat
  clear, /clear - Clear conversation context
  help, /help - Show this help message
```

## Usage Example

```bash
$ bun run dev

💬 Fred Dev Chat (Conversation ID: conv_1234567890_abc123)
Type your messages and press Enter. Type "exit" or "quit" to stop.
💡 Tip: Code changes will automatically reload Fred while preserving context!

> Hello!

🤖 Hello! How can I help you today?

> Calculate 5 + 3

🤖 The result is 8.

> [Edit code to add new intent...]

🔄 Reloading Fred...
✅ Fred reloaded successfully!

> Test new intent

🤖 [Response from new intent]
```

## File Watching

The dev chat watches these paths for changes:

- `src/` directory (recursive)
- `config.json`
- `fred.config.json`
- `config.yaml`
- `fred.config.yaml`

Changes trigger automatic reload with a 500ms debounce.

## Configuration

The dev chat works in two modes:

### Zero-Config Mode (No Setup Required)

If no agents are configured, dev-chat automatically:
1. Detects available AI providers from environment variables (see [API Key Environment Variables](#api-key-environment-variables) below)
2. Prompts to install missing provider packages if needed
3. Creates a temporary dev agent for testing
4. Sets it as the default agent

This allows you to start testing immediately without any configuration!

#### Built-in Tools

The temporary dev agent automatically includes the **calculator tool**, allowing you to test mathematical operations immediately:

```
> What is 123 * 456?

🤖 [Calls calculator tool with expression "123 * 456"]
🤖 The result is 56,088.

> Calculate (100 + 50) / 3

🤖 [Calls calculator tool]
🤖 The result is 50.
```

No configuration needed - the calculator tool works out of the box! This demonstrates Fred's tool system and gives you something to test with immediately.

To add the calculator to your own agents, see the [Tools Guide](tools.md#built-in-tools).

#### API Key Environment Variables

Dev-chat automatically detects providers from environment variables. Create a `.env` file in your project root:

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
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_aws_region
AI_GATEWAY_API_KEY=your_vercel_gateway_key
VERCEL_API_KEY=your_vercel_key
```

You only need to add the API key for the provider you want to use. Dev-chat will automatically detect it and use it. Make sure `.env` is in your `.gitignore` to avoid committing secrets.

### Configured Mode

If you have a config file or agents defined in code:

1. Loads config files automatically (`config.json`, `fred.config.json`, `config.yaml`, `fred.config.yaml`)
2. Uses environment variables for API keys
3. Registers default providers if no config
4. Uses your defined agents instead of the temporary dev agent

## Best Practices

1. **Keep Terminal Open**: Leave the dev chat running while developing
2. **Test Incrementally**: Test changes as you make them
3. **Use Clear Command**: Clear context when testing new features
4. **Watch for Reloads**: Check reload messages to ensure changes are picked up

## Troubleshooting

### Reload Not Working

- Check that files are being saved
- Verify file paths are correct
- Check console for error messages

### Context Not Preserved

- Ensure conversation ID is maintained
- Check that context manager is working
- Verify no errors during reload

### No Response

- Check that providers are configured
- Verify API keys are set (e.g., `OPENAI_API_KEY`, `GROQ_API_KEY`)
- If no agents are configured, dev-chat should auto-create a dev agent
- Check console for error messages about provider registration or package installation

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Intents](intents.md)
- Check [Examples](../examples/basic-usage.md)

