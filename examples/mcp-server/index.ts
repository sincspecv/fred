import { Fred } from '../../src/index';

/**
 * Example: Using MCP Server Integration
 * 
 * This example demonstrates how to connect an agent to an MCP server
 * to automatically discover and use tools from the server.
 * 
 * In this case, we're using the filesystem MCP server which provides
 * tools for reading and writing files.
 * 
 * Prerequisites:
 * - Install the filesystem MCP server: npm install -g @modelcontextprotocol/server-filesystem
 * - Or use npx to run it on-demand (as shown in the example)
 */

async function main() {
  const fred = new Fred();

  // Register a provider
  await fred.useProvider('openai', {
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Create an agent with MCP server integration
  // The filesystem MCP server provides tools like read_file, write_file, etc.
  await fred.createAgent({
    id: 'file-assistant',
    systemMessage: `You are a helpful file assistant. You can read and write files using the tools available from the MCP server.
    
When users ask you to:
- Read a file: Use the read_file tool
- Write to a file: Use the write_file tool
- List directory contents: Use the list_directory tool

Always be careful with file operations and confirm before making changes.`,
    platform: 'openai',
    model: 'gpt-4',
    mcpServers: [
      {
        id: 'filesystem',
        name: 'File System',
        transport: 'stdio',
        command: 'npx',
        args: [
          '-y', // Use -y to automatically accept npx prompts
          '@modelcontextprotocol/server-filesystem',
          process.cwd(), // Allow access to current working directory
        ],
        // Optional: Set environment variables if needed
        env: {
          // Add any required environment variables here
        },
      },
    ],
  });

  // Set as default agent
  fred.setDefaultAgent('file-assistant');

  console.log('File Assistant with MCP Server Integration');
  console.log('==========================================\n');

  // Example 1: Read a file
  console.log('Example 1: Reading a file');
  console.log('User: "Read the package.json file"');
  try {
    const response1 = await fred.processMessage('Read the package.json file');
    console.log('Assistant:', response1?.content);
    if (response1?.toolCalls && response1.toolCalls.length > 0) {
      console.log('\nTool calls made:');
      response1.toolCalls.forEach(tc => {
        console.log(`  - ${tc.toolId}: ${JSON.stringify(tc.args)}`);
        if (tc.result) {
          console.log(`    Result: ${typeof tc.result === 'string' ? tc.result.substring(0, 100) + '...' : JSON.stringify(tc.result).substring(0, 100) + '...'}`);
        }
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Example 2: List directory
  console.log('Example 2: Listing directory contents');
  console.log('User: "List the files in the src directory"');
  try {
    const response2 = await fred.processMessage('List the files in the src directory');
    console.log('Assistant:', response2?.content);
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Example 3: Write a file (if the MCP server supports it)
  console.log('Example 3: Writing a file');
  console.log('User: "Create a test.txt file with the content Hello from MCP!"');
  try {
    const response3 = await fred.processMessage('Create a test.txt file with the content "Hello from MCP!"');
    console.log('Assistant:', response3?.content);
    if (response3?.toolCalls && response3.toolCalls.length > 0) {
      console.log('\nTool calls made:');
      response3.toolCalls.forEach(tc => {
        console.log(`  - ${tc.toolId}: ${JSON.stringify(tc.args)}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
