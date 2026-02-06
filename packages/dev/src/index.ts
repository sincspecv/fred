/**
 * @fancyrobot/fred-dev - Fred AI framework development tools
 *
 * This package provides development tooling for Fred:
 * - dev-chat: Interactive development chat interface with hot reload
 * - server: HTTP server for chat API
 *
 * These tools are not needed in production installs.
 */

// Re-export main dev tools
export { startDevChat } from './dev-chat';
export { startServer, ServerApp } from './server';
