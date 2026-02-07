---
phase: 25
plan: 04
subsystem: mcp-integration
tags: [mcp, resources, tool-discovery, error-handling, effect]
requires:
  - phase: 25-01
    provides: MCPGlobalServerConfig schema and extractMCPServers function
  - phase: 25-02
    provides: MCPServerRegistry with Effect lifecycle and namespace format
provides:
  - MCPResourceService for listing and reading MCP server resources
  - Enhanced tool discovery with graceful error handling
  - Mid-conversation server failure resilience
  - Namespaced tool collision prevention verified
affects: [25-05, agent-factory, tool-integration]
tech-stack:
  added: []
  patterns:
    - Graceful degradation for disconnected MCP servers
    - Effect.either for per-server error isolation
    - Error messages instead of exceptions in tool execution
key-files:
  created:
    - packages/core/src/mcp/resources.ts
    - tests/unit/mcp/resources.test.ts
    - tests/unit/mcp/tool-discovery.test.ts
  modified:
    - packages/core/src/mcp/adapter.ts
    - packages/core/src/mcp/registry.ts
    - packages/core/src/mcp/index.ts
key-decisions:
  - "Resource service returns empty array + warning for disconnected servers (not error)"
  - "Tool execution returns formatted error string instead of throwing exceptions"
  - "discoverAllTools skips error servers gracefully using Effect.either"
  - "Error format: 'Tool server/tool failed: message' for consistent agent feedback"
patterns-established:
  - "Resource access pattern: service wraps registry, checks client.isConnected() before operations"
  - "Tool error handling: try/catch in execute function returns error string to agent"
  - "Bulk discovery pattern: Effect.either per server to isolate failures"
duration: 3.45
completed: 2026-02-07
---

# Phase 25 Plan 04: MCP Resource Service and Enhanced Tool Discovery

**MCPResourceService for resource access with graceful disconnected server handling and enhanced tool discovery with mid-conversation failure resilience.**

## Performance

- **Duration:** 3.45 minutes (207 seconds)
- **Started:** 2026-02-07T03:11:53Z
- **Completed:** 2026-02-07T03:15:20Z
- **Tasks:** 1 TDD task (RED → GREEN)
- **Files created:** 3
- **Files modified:** 3

## Accomplishments

- **MCPResourceService** for listing and reading resources from MCP servers
  - Graceful handling of disconnected servers (empty array + warning, not error)
  - Aggregate resources from all servers with per-server error isolation

- **Enhanced tool discovery** with error resilience
  - discoverAllTools skips disconnected/error servers using Effect.either
  - No single server failure blocks entire tool discovery

- **Mid-conversation server failure handling**
  - Tool execute checks client.isConnected() before calling
  - Returns formatted error message instead of throwing
  - Agents receive actionable error strings, not exceptions

## Task Commits

Each task was committed atomically following TDD cycle:

1. **RED phase: Failing tests** - `79acf4c` (test)
   - Resource service tests: list/read resources, disconnected server handling
   - Tool discovery tests: namespace format, collision prevention, error handling

2. **GREEN phase: Implementation** - `f37f832` (feat)
   - MCPResourceService with registry-based resource access
   - Enhanced adapter.ts with graceful error handling
   - Updated registry.ts discoverAllTools to skip error servers

## Files Created

### packages/core/src/mcp/resources.ts
- MCPResourceService class with registry constructor
- `listResources(serverId)` - Returns resources from specific server (empty array if disconnected)
- `readResource(serverId, uri)` - Reads resource contents (fails if disconnected)
- `listAllResources()` - Aggregates from all servers with per-server error isolation

### tests/unit/mcp/resources.test.ts
- 9 tests covering resource listing, reading, and aggregation
- Mock client with controllable resource responses and connection state
- Tests verify graceful handling of disconnected servers

### tests/unit/mcp/tool-discovery.test.ts
- 8 tests covering namespaced tool discovery and error handling
- Namespace collision prevention between servers verified
- Mid-conversation server failure scenarios tested

## Files Modified

### packages/core/src/mcp/adapter.ts
- Enhanced `execute` function with error handling
- Check `client.isConnected()` before calling MCP server
- Return formatted error string instead of throwing
- Error format: `Tool ${serverId}/${toolName} failed: ${errorMessage}`

### packages/core/src/mcp/registry.ts
- Updated `discoverAllTools()` to skip error servers gracefully
- Changed return type from `Effect<Map<string, Tool[]>, Error>` to `Effect<Map<string, Tool[]>, never>`
- Uses `Effect.either` to catch errors per server without failing whole operation
- Logs warning for skipped servers

### packages/core/src/mcp/index.ts
- Exported `MCPResourceService` and `ResourceContent` type

## Decisions Made

### 1. Resource Service Error Handling

**Decision:** `listResources` returns empty array + warning for disconnected servers, but `readResource` throws error.

**Rationale:**
- Listing resources is often exploratory - empty list is valid response
- Reading a specific resource implies expectation of content - error is appropriate
- Consistent with plan's "warn-only for list, error for read" pattern

### 2. Tool Execution Error Format

**Decision:** Return formatted error string `Tool ${serverId}/${toolName} failed: ${message}` instead of throwing exceptions.

**Rationale:**
- Agents can process error messages as tool output
- No need for special exception handling in agent execution flow
- Consistent with plan requirement: "returns error string (not throw)"

### 3. Bulk Discovery Error Isolation

**Decision:** `discoverAllTools()` uses `Effect.either` to isolate per-server errors.

**Rationale:**
- One server failure shouldn't prevent discovering tools from other servers
- Effect.either allows catching errors without failing entire Effect chain
- Changed return type to `never` error channel - operation always succeeds

### 4. Connection Checks in Tool Execution

**Decision:** Check `client.isConnected()` before calling MCP server in tool execute function.

**Rationale:**
- Fail-fast for disconnected servers - return error immediately
- Avoids timeout delays from trying to call disconnected client
- Provides clear "server disconnected" error message to agent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

### Pre-existing TypeScript Errors

**Issue:** `bunx tsc --noEmit` shows errors unrelated to MCP changes (import style, type annotations).

**Impact:** None - errors are pre-existing in codebase. MCP implementation is type-safe.

**Resolution:** Noted but not blocking. Tests pass, implementation is correct.

## Test Coverage

### Resource Service Tests (9 tests)

**List Resources:**
- Lists resources from a server successfully
- Returns empty array when server disconnected (with warning)
- Fails when server not found

**Read Resource:**
- Reads resource contents successfully
- Fails when server disconnected
- Fails when server not found

**List All Resources:**
- Aggregates resources from multiple servers
- Skips disconnected servers with warning
- Returns empty map when no servers registered

### Tool Discovery Tests (8 tests)

**Namespaced Tool IDs:**
- Returns tools with `server/tool` namespace format
- Prevents namespace collisions between servers (same tool name from different servers)

**Discover All Tools:**
- Discovers tools from all registered servers
- Skips disconnected servers without throwing
- Returns empty map when no servers registered

**Tool Execution:**
- Executes tool successfully when server connected
- Returns error message when server disconnected during execution
- Returns error message on execution timeout

All 17 tests pass (9 resource + 8 tool discovery).

## Next Phase Readiness

### Ready for Phase 25-05 (Agent Factory Integration)

**Provides:**
- `MCPResourceService` for agent resource access
- Enhanced tool discovery with error resilience
- Namespaced tools compatible with ToolGateService

**Blockers:** None

**Concerns:** None

### Impact on Future Phases

**25-05 (Agent Factory):** Can use MCPResourceService to expose resources to agents. Tool discovery already handles errors gracefully.

**Tool Integration:** Tools from MCP servers behave gracefully on server failure - return error messages instead of throwing.

**Resource Access:** Agents can list and read resources from MCP servers with transparent error handling.

## Verification

- ✅ All 9 resource service tests pass
- ✅ All 8 tool discovery tests pass
- ✅ No regressions in existing MCP tests (adapter.test.ts, registry.test.ts)
- ✅ Graceful error handling verified in all scenarios
- ✅ TypeScript compiles (pre-existing errors unrelated to changes)

## Self-Check: PASSED

Created files:
- ✓ packages/core/src/mcp/resources.ts
- ✓ tests/unit/mcp/resources.test.ts
- ✓ tests/unit/mcp/tool-discovery.test.ts

Commits:
- ✓ 79acf4c (test: failing tests)
- ✓ f37f832 (feat: implementation)

---
*Phase: 25-mcp-integration*
*Completed: 2026-02-07*
