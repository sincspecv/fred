#!/usr/bin/env bun

import { Fred } from './index';
import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import chokidar from 'chokidar';

/**
 * Development chat interface with hot reload
 * Maintains conversation context until terminal is closed
 */

/**
 * Detect available AI provider from environment variables
 * Returns platform and model, or null if no provider available
 * 
 * Supports all major AI SDK providers with simple API key authentication.
 * Providers are checked in order of preference (most stable/common first).
 */
function detectAvailableProvider(): { platform: string; model: string } | { platform: null; model: null } {
  // Check environment variables in order of preference
  // Priority: Most stable/common providers first, then others
  
  // Tier 1: Most popular and stable providers
  if (process.env.OPENAI_API_KEY) {
    return { platform: 'openai', model: 'gpt-3.5-turbo' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { platform: 'anthropic', model: 'claude-3-5-haiku-latest' };
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { platform: 'google', model: 'gemini-1.5-flash' };
  }
  
  // Tier 2: Fast and cost-effective providers
  if (process.env.MISTRAL_API_KEY) {
    return { platform: 'mistral', model: 'mistral-small-latest' };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { platform: 'deepseek', model: 'deepseek-chat' };
  }
  if (process.env.GROQ_API_KEY) {
    return { platform: 'groq', model: 'openai/gpt-oss-120b' };
  }
  
  // Tier 3: Additional providers
  if (process.env.COHERE_API_KEY) {
    return { platform: 'cohere', model: 'command' };
  }
  if (process.env.PERPLEXITY_API_KEY) {
    return { platform: 'perplexity', model: 'llama-3.1-sonar-small-128k-online' };
  }
  if (process.env.FIREWORKS_API_KEY) {
    return { platform: 'fireworks', model: 'accounts/fireworks/models/llama-v3-70b-instruct' };
  }
  if (process.env.TOGETHER_API_KEY) {
    return { platform: 'together', model: 'meta-llama/Llama-3-70b-chat-hf' };
  }
  if (process.env.XAI_API_KEY) {
    return { platform: 'xai', model: 'grok-beta' };
  }
  if (process.env.REPLICATE_API_KEY) {
    return { platform: 'replicate', model: 'meta/llama-2-70b-chat' };
  }
  // Note: ai21, nvidia, upstash, lepton don't have official @ai-sdk packages
  // They may be available as community packages but are not included in auto-detection
  // Users should configure these manually in config files if needed
  if (process.env.CEREBRAS_API_KEY) {
    return { platform: 'cerebras', model: 'llama3.3-70b' };
  }
  // Note: DeepInfra and Baseten have various models available
  // Model names vary - users should specify models in config files
  // if (process.env.DEEPINFRA_API_KEY) {
  //   return { platform: 'deepinfra', model: 'meta-llama/Llama-3-70b-instruct' };
  // }
  // if (process.env.BASETEN_API_KEY) {
  //   return { platform: 'baseten', model: 'meta-llama/Llama-3-70b-instruct' };
  // }
  
  // Note: Providers requiring complex auth (AWS Bedrock, Azure, etc.) are not auto-detected
  // Note: Ollama requires local setup and baseURL, so not included in auto-detection
  // Note: Cloudflare Workers AI requires different setup
  
  // No providers available
  return { platform: null, model: null };
}

/**
 * Map platform names to their @ai-sdk package names
 */
function getPackageNameForPlatform(platform: string): string | null {
  const packageMap: Record<string, string> = {
    'openai': '@ai-sdk/openai',
    'anthropic': '@ai-sdk/anthropic',
    'google': '@ai-sdk/google',
    'mistral': '@ai-sdk/mistral',
    'groq': '@ai-sdk/groq',
    'cohere': '@ai-sdk/cohere',
    'vercel': '@ai-sdk/vercel',
    'azure-openai': '@ai-sdk/azure',
    'azure-anthropic': '@ai-sdk/azure',
    'azure': '@ai-sdk/azure',
    'fireworks': '@ai-sdk/fireworks',
    'xai': '@ai-sdk/xai',
    'ollama': 'ai-sdk-ollama',
    'bedrock': '@ai-sdk/amazon-bedrock',
    'amazon-bedrock': '@ai-sdk/amazon-bedrock',
    'elevenlabs': '@ai-sdk/elevenlabs',
    'perplexity': '@ai-sdk/perplexity',
    'replicate': '@ai-sdk/replicate',
    'together': '@ai-sdk/togetherai',
    'deepseek': '@ai-sdk/deepseek',
    'cerebras': '@ai-sdk/cerebras',
    'deepinfra': '@ai-sdk/deepinfra',
    'baseten': '@ai-sdk/baseten',
  };
  
  return packageMap[platform.toLowerCase()] || null;
}

/**
 * Prompt user for yes/no input
 */
async function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    
    // Check if stdin is available
    if (!stdin || stdin.destroyed) {
      resolve(false);
      return;
    }
    
    process.stdout.write(`${question} (y/n): `);
    
    stdin.resume();
    stdin.setEncoding('utf8');
    
    let input = '';
    
    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\n' || char === '\r') {
          // End of line - process the input
          const trimmed = input.trim().toLowerCase();
          stdin.pause();
          stdin.removeListener('data', onData);
          
          if (trimmed === 'y' || trimmed === 'yes') {
            process.stdout.write(`yes\n`);
            resolve(true);
            return;
          } else if (trimmed === 'n' || trimmed === 'no' || trimmed === '') {
            // Empty input defaults to 'no'
            process.stdout.write(trimmed ? 'no\n' : '\n');
            resolve(false);
          } else {
            // Invalid input - ask again
            process.stdout.write(`\nPlease enter 'y' or 'n': `);
            input = '';
            // Don't re-add listener - it's already there, just resume
            stdin.resume();
          }
          return;
        } else if (char === '\u0003') {
          // Ctrl+C
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(false);
          return;
        } else if (char >= ' ') {
          // Printable character
          input += char;
        }
      }
    };
    
    stdin.on('data', onData);
  });
}

/**
 * Install a package using bun add
 */
async function installPackage(packageName: string): Promise<void> {
  console.log(`\n📦 Installing ${packageName}...\n`);
  
  try {
    // Use bun add to install the package
    execSync(`bun add ${packageName}`, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    
    // Verify it was added to devDependencies or dependencies
    const packageJsonPath = join(process.cwd(), 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      // Check if it's in devDependencies or dependencies with a valid version
      const devVersion = packageJson.devDependencies?.[packageName];
      const depVersion = packageJson.dependencies?.[packageName];
      const version = devVersion || depVersion;
      
      if (version && version.trim() !== '') {
        console.log(`\n✅ ${packageName} installed successfully! (version: ${version})\n`);
        return;
      }
      
      // If not found, add it to devDependencies manually
      console.log(`\n⚠️  Package installed but not in devDependencies. Adding manually...\n`);
      if (!packageJson.devDependencies) {
        packageJson.devDependencies = {};
      }
      packageJson.devDependencies[packageName] = 'latest';
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      
      // Run bun install to sync
      execSync('bun install', {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
    }
    
    console.log(`\n✅ ${packageName} installed successfully!\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const exitCode = error && typeof error === 'object' && 'status' in error ? (error as any).status : 'unknown';
    console.error(`\n❌ Failed to install ${packageName}`);
    console.error(`   Error: ${errorMessage}`);
    if (exitCode !== 'unknown') {
      console.error(`   Exit code: ${exitCode}`);
    }
    console.error(`   Please install it manually: bun add ${packageName}\n`);
    throw error;
  }
}

/**
 * Try to verify if a package is actually installed and resolvable
 * This is more reliable than checking package.json, which can be out of sync
 * 
 * Strategy:
 * 1. Try to dynamically import the package
 * 2. If import succeeds -> package is installed
 * 3. If "Cannot find module" -> package is NOT installed
 * 4. If other errors (like zod/v4) -> package IS installed but has peer deps issues
 */
async function verifyPackageInstalled(packageName: string): Promise<boolean> {
  try {
    // Try to actually import the package - this is the most reliable check
    await import(packageName);
    // Import succeeded - package is installed and resolvable
    return true;
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = error.message;
      
      // "Cannot find module" means the package is not installed at all
      // Also treat zod/v4 resolution issues as not installed (common Bun cache/peer dep issue)
      if (
        errorMessage.includes('Cannot find module') ||
        errorMessage.includes('Could not resolve') ||
        errorMessage.includes('zod/v4')
      ) {
        return false;
      }
      
      // Other errors (like zod/v4, peer deps, etc.) mean the package IS installed
      // but has dependency issues. We consider it installed because:
      // 1. The package exists and Bun can resolve it
      // 2. The peer dependency issues will be handled when the provider is actually used
      // 3. This prevents false negatives during debugging
      return true;
    }
    
    // Unknown error - assume not installed to be safe
    return false;
  }
}

/**
 * Ensure required provider package is installed
 * Checks for the package based on detected provider and installs if missing
 * @returns true if a package was just installed, false otherwise
 */
async function ensureProviderPackageInstalled(): Promise<boolean> {
  const providerInfo = detectAvailableProvider();
  
  if (!providerInfo.platform) {
    // No provider detected, nothing to install
    return false;
  }

  const packageName = getPackageNameForPlatform(providerInfo.platform);
  
  if (!packageName) {
    // Platform doesn't have a corresponding @ai-sdk package
    // (e.g., custom providers, community packages, etc.)
    return false;
  }

  // Check if package is actually installed and resolvable
  // This uses actual module resolution, which is more reliable than checking package.json
  const isInstalled = await verifyPackageInstalled(packageName);
  
  if (isInstalled) {
    // Package is already installed
    return false;
  }

  // Package is not installed - prompt the user
  console.log(`\n📦 Required package ${packageName} is not installed.`);
  console.log(`   This package is required to run dev-chat with ${providerInfo.platform}.\n`);
  
  const shouldInstall = await promptYesNo('Would you like to install it now?');
  
  if (!shouldInstall) {
    console.log('\n👋 Exiting. Please install the package manually and try again:');
    console.log(`   bun add ${packageName}\n`);
    process.exit(0);
    return false; // Unreachable
  }
  
  // User wants to install - install the package
  console.log(`\n✅ User confirmed installation. Proceeding with installation of ${packageName}...\n`);
  
  try {
    // Call installPackage and wait for it to complete
    await installPackage(packageName);
    
    // If we reach here, installation succeeded
    // After installation, prompt user to restart
    // Note: installPackage already prints success message
    console.log('🔄 Please run `bun run dev` again to start the chat.\n');
    process.exit(0);
    return true; // Unreachable
  } catch (error) {
    // installPackage already prints detailed error messages, but we add a final message
    console.error(`\n   Installation failed. Please try installing manually:`);
    console.error(`   bun add ${packageName}\n`);
    process.exit(1);
    return false; // Unreachable
  }
}

/**
 * DevChatRunner class encapsulates all dev chat state and logic
 */
class DevChatRunner {
  private fred: Fred | null = null;
  private conversationId?: string;
  private isReloading = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private isWaitingForInput = false;
  private fileWatcher: chokidar.FSWatcher | null = null;
  private setupHook?: (fred: Fred) => Promise<void>;

  constructor(setupHook?: (fred: Fred) => Promise<void>) {
    this.setupHook = setupHook;
  }

  /**
   * Initialize or reload Fred instance
   */
  private async initializeFred() {
    if (this.isReloading) return;
    this.isReloading = true;

    try {
      // Clear any pending reload timers
      if (this.reloadTimer) {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = null;
      }

      // Create new Fred instance
      const newFred = new Fred();
      
      // Try to load config files
      const configPaths = [
        resolve(process.cwd(), 'src', 'config.json'),
        resolve(process.cwd(), 'config.json'),
        resolve(process.cwd(), 'fred.config.json'),
        resolve(process.cwd(), 'src', 'config.yaml'),
        resolve(process.cwd(), 'config.yaml'),
        resolve(process.cwd(), 'fred.config.yaml'),
      ];

      let configLoaded = false;
      for (const configPath of configPaths) {
        if (existsSync(configPath)) {
          try {
            await newFred.initializeFromConfig(configPath);
            if (!this.isWaitingForInput) {
              console.log(`✅ Loaded config from ${configPath}`);
            }
            configLoaded = true;
            break;
          } catch (error: any) {
            // Config file exists but invalid, continue to next
            if (!this.isWaitingForInput && error.message) {
              console.warn(`⚠️  Config file ${configPath} exists but has errors: ${error.message}`);
            }
          }
        }
      }

      if (!configLoaded) {
        // Register default providers if no config
        await newFred.registerDefaultProviders();
        if (!this.isWaitingForInput) {
          console.log('✅ Using default providers (set OPENAI_API_KEY or GROQ_API_KEY)');
          console.log('💡 Tip: Create a config.json file or use initializeFromConfig() in your code');
        }
      }

      // Call setup hook if provided (for project-specific setup like registering agents/tools/intents)
      if (this.setupHook) {
        try {
          await this.setupHook(newFred);
        } catch (error) {
          if (!this.isWaitingForInput) {
            console.warn('⚠️  Failed to run setup hook:', error instanceof Error ? error.message : error);
            console.warn('   Continuing with auto-agent creation if needed...\n');
          }
        }
      }

    // Auto-create dev agent if no agents exist
    const agents = newFred.getAgents();
    if (agents.length === 0) {
      // Auto-create dev agent
      const providerInfo = detectAvailableProvider();
      if (providerInfo.platform && providerInfo.model) {
        try {
          // Ensure the provider is registered before creating the agent
          // Register the provider explicitly to ensure it's available
          try {
            await newFred.useProvider(providerInfo.platform);
            if (!this.isWaitingForInput) {
              console.log(`✅ Registered ${providerInfo.platform} provider`);
            }
          } catch (providerError) {
            // Always show provider registration errors
            const packageName = providerInfo.platform === 'google' ? 'google' : providerInfo.platform;
            console.error(`\n❌ Failed to register ${providerInfo.platform} provider:`, providerError instanceof Error ? providerError.message : providerError);
            console.error(`   Install with: bun add @ai-sdk/${packageName}`);
            console.error('');
            // Can't create agent without provider
            throw providerError;
          }

          // Now create the agent with the registered provider
          if (!this.isWaitingForInput) {
            console.log(`Creating dev agent with ${providerInfo.platform}/${providerInfo.model}...`);
          }
          
          await newFred.createAgent({
            id: '__dev_agent__',
            systemMessage: 'You are a helpful development assistant. This is a temporary agent created for dev-chat. Create your own agents in your config file or code to replace this.',
            platform: providerInfo.platform,
            model: providerInfo.model,
          });
          
          // Verify agent was created
          const createdAgent = newFred.getAgent('__dev_agent__');
          if (!createdAgent) {
            throw new Error('Agent was created but could not be retrieved');
          }
          
          // Set as default agent
          newFred.setDefaultAgent('__dev_agent__');
          
          // Verify default agent is set
          const defaultAgentId = newFred.getDefaultAgentId();
          if (defaultAgentId !== '__dev_agent__') {
            throw new Error(`Default agent not set correctly. Expected '__dev_agent__', got '${defaultAgentId}'`);
          }
          
          // Verify agents list
          const allAgents = newFred.getAgents();
          if (allAgents.length === 0) {
            throw new Error('Agent was created but does not appear in agents list');
          }
          
          if (!this.isWaitingForInput) {
            console.log('💡 Auto-created dev agent for testing (temporary)');
            console.log(`   Platform: ${providerInfo.platform}, Model: ${providerInfo.model}`);
            console.log(`   Agent ID: __dev_agent__, Default: ${newFred.getDefaultAgentId()}`);
            console.log('   Create your own agents in config.json or code to replace this.\n');
          }
        } catch (error) {
          // Failed to create agent (e.g., provider not properly registered)
          // Always show error, even if user is typing (this is important)
          console.error('\n❌ Failed to auto-create dev agent:', error instanceof Error ? error.message : error);
          if (error instanceof Error && error.stack) {
            console.error('Stack trace:', error.stack);
          }
          if (error instanceof Error && error.message.includes('not installed')) {
            const packageName = providerInfo.platform === 'google' ? 'google' : providerInfo.platform;
            console.error(`   Install the provider package: bun add @ai-sdk/${packageName}`);
          } else if (error instanceof Error && error.message.includes('No provider registered')) {
            console.error(`   The ${providerInfo.platform} provider failed to register. Check your API key.`);
            console.error(`   Make sure ${providerInfo.platform.toUpperCase()}_API_KEY is set in your environment.`);
          } else {
            console.error('   Make sure the provider is properly registered and API keys are set.');
          }
          console.error('');
        }
      } else {
        // No providers available
        if (!this.isWaitingForInput) {
          console.warn('⚠️  No AI providers available. Set one of the following API keys:');
          console.warn('   - OPENAI_API_KEY (OpenAI)');
          console.warn('   - ANTHROPIC_API_KEY (Anthropic)');
          console.warn('   - GOOGLE_GENERATIVE_AI_API_KEY (Google)');
          console.warn('   - MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or others');
          console.warn('   Dev-chat requires at least one provider to be configured.\n');
        }
      }
    } else {
      // Agents already exist - check if default is set
      const defaultAgentId = newFred.getDefaultAgentId();
      if (!defaultAgentId && !this.isWaitingForInput) {
        console.warn('⚠️  Agents exist but no default agent is set.');
        console.warn('   Set a default agent with: fred.setDefaultAgent(agentId)\n');
      }
    }

      // Preserve conversation context if it exists
      if (this.fred && this.conversationId) {
        const contextManager = this.fred.getContextManager();
        const history = await contextManager.getHistory(this.conversationId);
        
        if (history.length > 0) {
          const newContextManager = newFred.getContextManager();
          await newContextManager.addMessages(this.conversationId, history);
          if (!this.isWaitingForInput) {
            console.log(`✅ Preserved conversation context (${history.length} messages)`);
          }
        }
      } else if (!this.conversationId) {
        // Generate new conversation ID on first load
        this.conversationId = newFred.getContextManager().generateConversationId();
      }

      this.fred = newFred;
    } catch (error) {
      if (!this.isWaitingForInput) {
        console.error('❌ Error reloading Fred:', error instanceof Error ? error.message : error);
      }
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * Watch for file changes and reload using chokidar
   */
  public setupFileWatcher() {
    // Prevent memory leak: close existing watcher if one exists
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch {
        // Ignore errors when closing existing watcher
      }
      this.fileWatcher = null;
    }

  const projectRoot = process.cwd();
  const watchPaths = [
    resolve(projectRoot, 'src'),
    resolve(projectRoot, 'config.json'),
    resolve(projectRoot, 'fred.config.json'),
    resolve(projectRoot, 'config.yaml'),
    resolve(projectRoot, 'fred.config.yaml'),
  ];

  // Filter to only existing paths and validate they're within project root
  const existingPaths = watchPaths.filter(p => {
    if (!existsSync(p)) {
      return false;
    }
    // Security: Ensure path is within project root (prevent path traversal)
    const normalizedPath = resolve(p);
    const normalizedRoot = resolve(projectRoot);
    return normalizedPath.startsWith(normalizedRoot + '/') || normalizedPath === normalizedRoot;
  });
  
  if (existingPaths.length === 0) {
    console.warn('⚠️  No paths to watch found. File watching disabled.');
    return;
  }

    console.log(`👀 Watching ${existingPaths.length} path(s) for changes...`);

    // Use chokidar to watch all paths
    this.fileWatcher = chokidar.watch(existingPaths, {
    ignored: [
      /node_modules/,
      /\.git/,
      /dist/,
      /lib/,
      /\.log$/,
      /\.swp$/,
      /\.tmp$/,
      /\.DS_Store/,
      // Additional security: ignore common system and backup files
      /\.bak$/,
      /\.backup$/,
      /\.orig$/,
      /\.pid$/,
      /\.lock$/,
      /\.cache/,
      /\.vscode/,
      /\.idea/,
    ],
    persistent: true,
    ignoreInitial: true, // Don't trigger on initial scan
    depth: 50, // Limit recursion depth to prevent resource exhaustion
    awaitWriteFinish: {
      stabilityThreshold: 100, // Wait 100ms after file stops changing
      pollInterval: 50,
    },
  });

    this.fileWatcher.on('change', (path) => {
      // Additional security: validate path is still within project root
      const normalizedPath = resolve(path);
      const normalizedRoot = resolve(projectRoot);
      if (!normalizedPath.startsWith(normalizedRoot + '/') && normalizedPath !== normalizedRoot) {
        // Path outside project root - ignore
        return;
      }

      // Debounce reloads to avoid multiple rapid reloads
      if (this.reloadTimer) {
        clearTimeout(this.reloadTimer);
      }

      this.reloadTimer = setTimeout(() => {
        if (!this.isWaitingForInput) {
          this.initializeFred();
        }
      }, 300);
    });

    this.fileWatcher.on('error', (error) => {
      console.error('File watcher error:', error);
      // On error, cleanup watcher to prevent resource leaks
      if (this.fileWatcher) {
        try {
          this.fileWatcher.close();
        } catch {
          // Ignore cleanup errors
        }
        this.fileWatcher = null;
      }
    });
  }

  /**
   * Read a line from stdin with better handling
   */
  private async readLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isWaitingForInput = true;
      const stdin = process.stdin;
      
      // Check if stdin is available
      if (!stdin || stdin.destroyed) {
        reject(new Error('stdin is not available or has been closed'));
        return;
      }
      
      // Set raw mode for better control (if available)
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        try {
          stdin.setRawMode(true);
        } catch {
          // ignore in non-TTY or restricted environments
        }
      }
      
      stdin.resume();
      stdin.setEncoding('utf8');

      let input = '';

      const cleanup = () => {
        this.isWaitingForInput = false;
        stdin.pause();
        if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
          try {
            stdin.setRawMode(false);
          } catch {
            // ignore
          }
        }
        stdin.removeListener('data', onData);
      };

    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\n' || char === '\r') {
          cleanup();
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          console.log('\n\n👋 Goodbye!');
          process.exit(0);
          return;
        } else if (char === '\u007f' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          // Printable character
          input += char;
          process.stdout.write(char);
        }
      }
    };

    stdin.on('data', onData);
  });
}

  /**
   * Interactive chat interface
   */
  public async start() {
    // Ensure required provider package is installed before initializing
    let packageWasInstalled = false;
    try {
      packageWasInstalled = await ensureProviderPackageInstalled();
    } catch (error) {
      console.error('\n❌ Failed to ensure provider package is installed.');
      console.error('   Please install the required package manually and try again.\n');
      process.exit(1);
    }
    
    // Initialize Fred
    // If we reach here, the package is installed (or no package needed)
    // If a package was missing, ensureProviderPackageInstalled() will have
    // prompted the user and exited the process
    await this.initializeFred();
    
    if (!this.fred) {
      console.error('❌ Failed to initialize Fred');
      process.exit(1);
    }

    // Generate conversation ID if not already set
    if (!this.conversationId) {
      this.conversationId = this.fred.getContextManager().generateConversationId();
    }

    console.log(`\n💬 Fred Dev Chat`);
    console.log(`📝 Conversation ID: ${this.conversationId}`);
    console.log('💡 Type your messages and press Enter. Code changes auto-reload!');
    console.log('📖 Type "help" for commands\n');

    while (true) {
      // Ensure fred is still available (might have been cleared during reload)
      if (!this.fred) {
        await this.initializeFred();
        if (!this.fred) {
          console.error('❌ Failed to reload Fred');
          continue;
        }
      }

      // Check if stdin is available and not destroyed
      if (!process.stdin || process.stdin.destroyed) {
        console.error('\n❌ stdin is not available. The process may have lost terminal access.');
        console.error('   This can happen after a restart. Please restart dev-chat manually.\n');
        process.exit(1);
      }

      // Ensure stdin is readable
      if (!process.stdin.readable) {
        console.error('\n❌ stdin is not readable. The process may have lost terminal access.');
        console.error('   This can happen after a restart. Please restart dev-chat manually.\n');
        process.exit(1);
      }

      process.stdout.write('> ');
      let message: string;
      try {
        message = await this.readLine();
      } catch (error) {
        if (error instanceof Error && (error.message.includes('stdin') || error.message.includes('not available'))) {
          console.error('\n❌ Failed to read from stdin:', error.message);
          console.error('   The process may have lost terminal access after restart.');
          console.error('   Please restart dev-chat manually: bun run dev\n');
          process.exit(1);
        }
        throw error;
      }

      if (!message.trim()) {
        continue;
      }

      const cmd = message.toLowerCase().trim();

      if (cmd === 'exit' || cmd === 'quit') {
        console.log('\n👋 Goodbye!');
        process.exit(0);
        return;
      }

      if (cmd === 'clear' || cmd === '/clear') {
        if (this.fred) {
          const contextManager = this.fred.getContextManager();
          await contextManager.clearContext(this.conversationId!);
          this.conversationId = this.fred.getContextManager().generateConversationId();
          console.log(`\n🧹 Conversation cleared. New ID: ${this.conversationId}\n`);
        }
        continue;
      }

      if (cmd === 'help' || cmd === '/help') {
        console.log('\n📖 Commands:');
        console.log('  exit, quit     - Exit the chat');
        console.log('  clear, /clear   - Clear conversation context');
        console.log('  help, /help    - Show this help message');
        console.log('  reload, /reload - Manually reload Fred\n');
        continue;
      }

      if (cmd === 'reload' || cmd === '/reload') {
        console.log('\n🔄 Manually reloading...');
        await this.initializeFred();
        continue;
      }

      try {
        // Process message
        if (!this.fred) {
          console.log('\n⚠️  Fred not initialized. Reloading...');
          await this.initializeFred();
          if (!this.fred) {
            console.log('\n❌ Failed to initialize Fred\n');
            continue;
          }
        }

        // Use streaming for real-time output
        // At this point, fred is guaranteed to be non-null due to checks above
        if (!this.fred) {
          console.log('\n❌ Fred not available\n');
          continue;
        }

        let hasReceivedChunk = false;
        let fullText = '';
        let toolCallsUsed: string[] = [];
        let hasShownToolIndicator = false;

        // Ensure stdout is ready for immediate writes
        // Unbuffer stdout if it's corked (shouldn't be, but ensure it)
        if (process.stdout.writable && typeof process.stdout.uncork === 'function') {
          process.stdout.uncork();
        }

        // Helper function to write with throttling for readability
        // Adds a small delay between writes to make streaming output easier on the eyes
        let lastWriteTime = 0;
        let pendingWrite: Promise<void> | null = null;
        const THROTTLE_MS = 20; // Delay between chunks (adjust for readability: 10-50ms recommended)
        const MAX_CHUNK_SIZE = 1024 * 1024; // 1MB max chunk size to prevent resource exhaustion
        
        const writeImmediate = async (text: string): Promise<void> => {
        if (text.length === 0) return;
        
        // Prevent resource exhaustion from extremely large chunks
        if (text.length > MAX_CHUNK_SIZE) {
          console.error(`\n⚠️  Warning: Chunk size (${text.length} bytes) exceeds maximum (${MAX_CHUNK_SIZE} bytes). Truncating.`);
          text = text.substring(0, MAX_CHUNK_SIZE);
        }
        
        // Wait for any pending write to complete before starting a new one
        // This prevents race conditions and ensures proper throttling
        if (pendingWrite) {
          await pendingWrite;
        }
        
        // Create a new promise for this write operation
        pendingWrite = (async () => {
          // Throttle: ensure at least THROTTLE_MS milliseconds between writes
          const now = Date.now();
          const timeSinceLastWrite = now - lastWriteTime;
          if (timeSinceLastWrite < THROTTLE_MS) {
            const delay = THROTTLE_MS - timeSinceLastWrite;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // Write to stdout - stdout.write is safe for text content
          // The AI SDK should already sanitize content, but we trust it here
          process.stdout.write(text);
          lastWriteTime = Date.now();
        })();
        
          await pendingWrite;
          pendingWrite = null;
        };

        // Start streaming response
        await writeImmediate('\n🤖 ');

        // Track if stream was aborted for proper cleanup
        let streamAborted = false;
        let streamController: AbortController | null = null;
        
        try {
          // Create abort controller for stream cleanup
          streamController = new AbortController();
          
          // Set up signal handler for graceful shutdown
          const abortHandler = () => {
            streamAborted = true;
            streamController?.abort();
          };
          
          // Note: We can't directly abort the async generator, but we can track the abort state
          // The for-await loop will naturally exit when the generator completes or throws
          
          for await (const chunk of this.fred.streamMessage(message, {
            conversationId: this.conversationId,
          })) {
            // Check if stream was aborted
            if (streamAborted || streamController?.signal.aborted) {
              break;
            }
            
            hasReceivedChunk = true;

            // Handle tool calls - show indicator when tools are detected
            if (chunk.toolCalls && chunk.toolCalls.length > 0 && !hasShownToolIndicator) {
              // If we've already written some text, add a newline before tool indicator
              if (fullText) {
                await writeImmediate('\n');
              }
              await writeImmediate('🔧 Using tools...\n');
              hasShownToolIndicator = true;
              
              // Track which tools are being used
              for (const toolCall of chunk.toolCalls) {
                if (toolCall.toolId && !toolCallsUsed.includes(toolCall.toolId)) {
                  toolCallsUsed.push(toolCall.toolId);
                }
              }
            }

            // Write text delta as it arrives - write with throttling for readability
            // Each chunk should appear in real-time as it's received from the AI SDK stream
            if (chunk.textDelta && chunk.textDelta.length > 0) {
              // Write the delta with throttling - the AI SDK should provide incremental chunks
              await writeImmediate(chunk.textDelta);
              fullText = chunk.fullText || fullText;
            } else if (chunk.fullText && chunk.fullText !== fullText) {
              // If we get a fullText update without a delta, write the difference
              // This handles cases where textDelta might be empty but fullText updated
              const diff = chunk.fullText.slice(fullText.length);
              if (diff) {
                await writeImmediate(diff);
              }
              fullText = chunk.fullText;
            }
          }
          
          // Clean up abort handler
          streamController = null;

          // After streaming completes, add final newline (only if not aborted)
          if (!streamAborted) {
            await writeImmediate('\n');
          }

          // Show tools used summary if any tools were called
          if (toolCallsUsed.length > 0) {
            console.log(`🔧 Tools used: ${toolCallsUsed.join(', ')}\n`);
          } else {
            // Add extra newline for spacing if no tools were used
            console.log('');
          }

          // If no chunks were received, provide debugging information
          if (!hasReceivedChunk) {
            const agents = this.fred.getAgents();
            const defaultAgentId = this.fred.getDefaultAgentId();
            const intents = this.fred.getIntents();
            
            console.log('❌ No response received.');
            console.log(`   Agents available: ${agents.length}`);
            if (agents.length > 0) {
              console.log(`   Agent IDs: ${agents.map(a => a.id).join(', ')}`);
            }
            console.log(`   Default agent: ${defaultAgentId || 'not set'}`);
            console.log(`   Intents registered: ${intents.length}`);
            
            if (agents.length === 0) {
              console.log('\n💡 No agents found. The dev agent should have been auto-created.');
              console.log('   Check the error messages above for provider registration issues.');
            } else if (!defaultAgentId) {
              console.log('\n💡 Agents exist but no default agent is set.');
              console.log('   The dev agent should have been set as default automatically.');
            }
            console.log('');
          }
        } catch (streamError) {
          // Clean up on error
          streamAborted = true;
          streamController?.abort();
          streamController = null;
          
          // If streaming fails, try to provide helpful error message
          // Don't show error if it was an abort (user interruption)
          if (!streamAborted || (streamError instanceof Error && streamError.name !== 'AbortError')) {
            console.error('\n❌ Streaming error:', streamError instanceof Error ? streamError.message : streamError);
            if (streamError instanceof Error && streamError.stack) {
              console.error(streamError.stack);
            }
            console.log('');
          }
        }
      } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) {
          console.error(error.stack);
        }
        console.log('');
      }
    }
  }

  /**
   * Cleanup file watcher
   */
  private cleanupWatcher() {
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.fileWatcher = null;
    }
  }

  /**
   * Setup cleanup handlers
   */
  public setupCleanup() {
    // Cleanup watcher on exit
    process.on('SIGINT', () => {
      this.cleanupWatcher();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      this.cleanupWatcher();
      process.exit(0);
    });
  }
}

/**
 * Start dev chat interface (exported for CLI use)
 * @param setupHook Optional function to call after Fred is initialized but before auto-agent creation
 */
export async function startDevChat(setupHook?: (fred: Fred) => Promise<void>) {
  const runner = new DevChatRunner(setupHook);
  runner.setupCleanup();
  runner.setupFileWatcher();
  await runner.start();
}

/**
 * Main function
 */
async function main() {
  const runner = new DevChatRunner();
  runner.setupCleanup();
  runner.setupFileWatcher();
  await runner.start();
}

// Run if this is the main module
// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch((error) => {
    console.error('Failed to start dev chat:', error);
    process.exit(1);
  });
}
