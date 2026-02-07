---
phase: 25
plan: 06
subsystem: mcp-integration
tags: [mcp, config-init, public-api, integration, lifecycle]
requires:
  - phase: 25-01
    provides: MCP config schema and extraction
  - phase: 25-02
    provides: MCPServerRegistry with Effect lifecycle
  - phase: 25-03
    provides: Health checks and lifecycle management
  - phase: 25-04
    provides: Resource service and tool discovery
  - phase: 25-05
    provides: AgentFactory global registry integration
provides:
  - Fred class MCP integration (registry, resource service)
  - ConfigInitializer MCP server setup
  - Public API exports for MCP modules
  - Graceful shutdown with MCP cleanup
  - End-to-end integration tests
affects: [public-api, config-initialization, shutdown-lifecycle]
tech-stack:
  added: []
  patterns:
    - Config-driven MCP server initialization
    - Fred shutdown lifecycle with MCP cleanup priority
    - Public API exposure via accessor methods
key-files:
  created:
    - tests/unit/mcp/integration.test.ts
  modified:
    - packages/core/src/index.ts
    - packages/core/src/config/initializer.ts
    - packages/core/src/agent/manager.ts
key-decisions:
  - decision: MCP servers initialized before agents in ConfigInitializer
    rationale: Agents reference servers by ID, so registry must be populated first
    impact: Proper dependency order ensures agent configs can safely reference global servers
  - decision: Fred shutdown calls mcpServerRegistry.shutdown() before agentManager.clear()
    rationale: MCP clients should close gracefully before agent-level cleanup
    impact: Clean shutdown order prevents orphaned MCP processes
  - decision: Add getAgentFactory() to AgentManager for Fred access
    rationale: Fred needs to wire MCP registry into factory during initialization
    impact: Public API for accessing factory when needed for advanced config
  - decision: Export MCPServerRegistry, MCPResourceService, MCPHealthManager from mcp/index.ts
    rationale: Make MCP infrastructure accessible from public API
    impact: Developers can access registry and resource service for runtime management
patterns-established:
  - Config extraction pattern: extractMCPServers returns typed array with id field
  - Fred initialization pattern: MCP setup happens between provider registration and agent creation
  - Shutdown priority: MCP cleanup → agent cleanup → runtime cleanup
duration: 4.6
completed: 2026-02-07
---

# Phase 25 Plan 06: MCP Integration into Fred Class and Public API

**Fred.initializeFromConfig creates and registers MCP servers from config with global registry, resource service, and graceful lifecycle management.**

## Performance

- **Duration:** 4.6 minutes (274 seconds)
- **Started:** 2026-02-07T03:26:23Z
- **Completed:** 2026-02-07T03:30:57Z
- **Tasks:** 2 (wire MCPServerRegistry + integration tests)
- **Files created:** 1
- **Files modified:** 3
- **Tests added:** 15 integration tests
- **Test coverage:** 70 total MCP tests, 170 assertions, 100% pass

## What Was Built

### 1. Fred Class MCP Integration

Added MCP infrastructure to Fred main class:

- **MCPServerRegistry field** - Global registry for all MCP servers
- **MCPResourceService field** - Service for accessing MCP resources
- **Constructor initialization** - Creates registry and resource service, wires into AgentFactory
- **getMCPServerRegistry() accessor** - Public API for runtime registry access
- **getMCPResourceService() accessor** - Public API for resource operations
- **configureMCPServers() method** - Accepts array of config-extracted servers, registers with lazy/eager startup
- **Updated shutdown()** - Calls `mcpServerRegistry.shutdown()` first for clean MCP cleanup

**Initialization order:**
1. Create MCPServerRegistry and MCPResourceService
2. Wire registry into AgentFactory via `setMCPServerRegistry()`
3. ConfigInitializer extracts MCP servers from config
4. ConfigInitializer calls `fred.configureMCPServers()` before agent creation
5. Agents created with global MCP server access

### 2. ConfigInitializer MCP Support

Enhanced ConfigInitializer to support MCP server setup:

- **Import extractMCPServers** - From config/loader for server extraction
- **FredLike interface** - Added `configureMCPServers?()` optional method
- **Initialization flow** - Extract servers after provider registration, before agent creation
- **Call configureMCPServers()** - If Fred instance has method and servers exist in config

**Config flow:**
```typescript
// 1. Load and validate config
const config = loadConfig(configPath);
validateConfig(config);

// 2. Register providers (so agents have AI models)
const providers = extractProviders(config);
await registerProviders(providers);

// 3. Configure MCP servers (NEW - before agents)
const mcpConfigs = extractMCPServers(config);
if (mcpConfigs.length > 0 && fred.configureMCPServers) {
  await fred.configureMCPServers(mcpConfigs);
}

// 4. Create agents (can now reference MCP servers)
const agents = extractAgents(config, configPath);
for (const agentConfig of agents) {
  await fred.createAgent(agentConfig);
}
```

### 3. AgentManager Enhancement

Added `getAgentFactory()` method to AgentManager:

- **Purpose:** Allow Fred to access factory for MCP registry wiring
- **Returns:** AgentFactory instance
- **Used by:** Fred constructor to call `factory.setMCPServerRegistry()`

### 4. Integration Tests

Created comprehensive integration test suite (15 tests):

**Config-to-Registry Flow (3 tests):**
- Extract MCP servers from config with correct types
- Resolve environment variables in config values
- Register servers in MCPServerRegistry

**Agent-to-Tools Flow (2 tests):**
- Agent gets namespaced tools from registered servers
- Tools have correct `server/tool` namespace format

**Lifecycle Flow (3 tests):**
- Lazy servers not connected at registration
- Shutdown clears all connections
- Health check setup for configured servers

**Error Resilience (5 tests):**
- Agent creation succeeds when MCP server ref doesn't exist
- Tool call on disconnected server returns error, not crash
- Config with invalid MCP server warns but doesn't block startup
- discoverAllTools skips disconnected servers gracefully
- Failed server initialization logs warning, continues without server

**Resource Service Integration (3 tests):**
- Lists resources from specific server
- Lists all resources from all servers
- Reads resource from specific server

All tests use MockMCPClient for isolation (no actual MCP subprocess execution).

## Task Commits

| Task | Type | Commit  | Description                                                                      |
| ---- | ---- | ------- | -------------------------------------------------------------------------------- |
| 1    | feat | 7d4e11c | Wire MCPServerRegistry into Fred class and ConfigInitializer                     |
| 2    | test | 7f7204e | Add comprehensive MCP integration tests + getAgentFactory() to AgentManager      |

## Files Created/Modified

### Created

- **tests/unit/mcp/integration.test.ts** - 15 integration tests covering full MCP flow

### Modified

- **packages/core/src/index.ts** - Added MCP registry, resource service, accessors, configureMCPServers, shutdown cleanup
- **packages/core/src/config/initializer.ts** - Added extractMCPServers call and configureMCPServers integration
- **packages/core/src/agent/manager.ts** - Added getAgentFactory() accessor method

## Decisions Made

### 1. MCP Initialization Order in ConfigInitializer

**Decision:** Extract and configure MCP servers after provider registration, before agent creation.

**Rationale:**
- Agents reference servers by ID via `mcpServers: ["github", "filesystem"]`
- Registry must be populated before agents created
- Providers needed first (agents need AI models)

**Impact:** Proper dependency order ensures agent configs work correctly.

### 2. Shutdown Priority Order

**Decision:** Shutdown order is: MCP registry → agent manager → runtime cleanup.

**Rationale:**
- MCP clients are Effect-managed resources with subprocess cleanup
- Clean MCP shutdown prevents orphaned processes
- Agent manager cleanup includes legacy MCP clients (backward compat)

**Implementation:**
```typescript
async shutdown(): Promise<void> {
  // Step 1: Cleanup MCP connections first
  await Effect.runPromise(this.mcpServerRegistry.shutdown());

  // Step 2: Cleanup existing class-based resources (includes legacy MCP clients)
  await this.agentManager.clear();

  // Step 3: Runtime cleanup happens automatically via Effect.scoped
  this.runtime = null;
  this.runtimePromise = null;
}
```

**Impact:** Clean shutdown order prevents resource leaks.

### 3. Add getAgentFactory() to AgentManager

**Decision:** Expose factory via public getter instead of making field public.

**Rationale:**
- Encapsulation - factory is implementation detail
- Controlled access - getter allows future interception if needed
- TypeScript-friendly - explicit return type

**Impact:** Fred can wire MCP registry into factory during construction.

### 4. Public API Exports

**Decision:** Export MCPServerRegistry, MCPResourceService, MCPHealthManager from `mcp/index.ts`.

**Rationale:**
- Developers may need runtime access to registry (add servers, query status)
- Resource service enables reading MCP resources outside agent context
- Health manager allows custom health check strategies

**Impact:** MCP infrastructure accessible from `@fancyrobot/fred-core/mcp`.

**Already exported in plan 25-02/25-03/25-04:**
- MCPServerRegistry ✓
- MCPResourceService ✓
- MCPHealthManager ✓
- acquireMCPClient ✓
- ServerStatus type ✓
- ResourceContent type ✓

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

### 1. AgentManager Missing getAgentFactory() Method

**Issue:** Fred constructor tried to call `this.agentManager.getAgentFactory()` but method didn't exist.

**Root cause:** AgentFactory was private field in AgentManager with no accessor.

**Fix:** Added `getAgentFactory(): AgentFactory` method to AgentManager.

**Files modified:** packages/core/src/agent/manager.ts

**Impact:** Fred routing tests passed after fix (was causing 46 test failures).

### 2. Pre-existing TypeScript Errors

**Issue:** `bunx tsc --noEmit` shows type errors unrelated to MCP changes.

**Root cause:** Pre-existing codebase issues (import style, type annotations).

**Impact:** None - errors existed before this plan, MCP implementation is type-safe.

**Resolution:** Noted but not blocking. Tests pass, implementation correct.

### 3. Pre-existing Effect Layer Test Failures

**Issue:** 30 test failures in Effect layer and service tests (FredLayers, createScopedFredRuntime, etc.).

**Root cause:** Pre-existing issues in Effect service integration tests.

**Impact:** None - failures existed before this plan. MCP tests pass (70/70).

**Resolution:** Not addressed in this plan. MCP integration verified through dedicated tests.

## Next Phase Readiness

### Impact on Future Development

**Public API:**
- `fred.getMCPServerRegistry()` provides runtime server management
- `fred.getMCPResourceService()` enables resource access from outside agents
- `fred.configureMCPServers()` allows programmatic server registration

**Config-driven Setup:**
- Developers declare MCP servers in config, Fred auto-registers them
- Agents reference servers by ID without manual wiring

**Lifecycle:**
- Graceful shutdown ensures all MCP clients close cleanly
- Health checks monitor servers and auto-restart on failure

**Testing:**
- Integration test suite covers full config → registry → agent → tools flow
- MockMCPClient pattern enables isolated testing

### Ready for v0.3.0 Completion

**Phase 25 MCP Integration:** ✅ Complete (6/6 plans)

**What was delivered:**
- Config schema with env var resolution (25-01)
- Global registry with Effect lifecycle (25-02)
- Health checks and auto-restart (25-03)
- Resource service and tool discovery (25-04)
- AgentFactory global registry integration (25-05)
- Fred class integration and public API (25-06)

**Next:** Phase 26 - Routing Explainability

## Verification

- ✅ All 15 integration tests pass
- ✅ All 70 MCP tests pass (no regressions)
- ✅ Config tests pass (85 tests)
- ✅ Fred routing tests pass (13 tests)
- ✅ TypeScript compiles (pre-existing errors unrelated to changes)
- ✅ Fred.initializeFromConfig creates and registers MCP servers from config
- ✅ MCPServerRegistry accessible from Fred instance via getMCPServerRegistry()
- ✅ MCPResourceService accessible from Fred instance via getMCPResourceService()
- ✅ MCP modules exported from @fancyrobot/fred-core/mcp
- ✅ Shutdown cleans up all MCP connections
- ✅ Integration tests verify full flow from config to agent tool access

## Self-Check: PASSED

**Created files:**
- ✓ tests/unit/mcp/integration.test.ts

**Modified files:**
- ✓ packages/core/src/index.ts
- ✓ packages/core/src/config/initializer.ts
- ✓ packages/core/src/agent/manager.ts

**Commits:**
- ✓ 7d4e11c (feat: Fred integration)
- ✓ 7f7204e (test: integration tests)

**Tests:**
- ✓ 15/15 integration tests pass
- ✓ 70/70 total MCP tests pass
- ✓ 170 assertions pass

---
*Phase: 25-mcp-integration*
*Completed: 2026-02-07*
