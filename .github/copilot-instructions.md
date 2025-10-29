# ByteRover CLI - AI Agent Instructions

## Project Overview

This is an **oclif v4 TypeScript CLI** (`br`) implementing **Clean Architecture** with pragmatic adaptations for command-line workflows. The CLI enables authentication, project initialization, and **Agentic Context Engineering (ACE)** - a systematic workflow for capturing agent work, learning from feedback, and building cumulative knowledge.

## Architecture Principles

### Clean Architecture with CLI Adaptations

- **Commands** (`src/commands/`) are the primary orchestrators of services
- **Services** (`src/infra/`) provide infrastructure implementations (HTTP, storage, auth)
- **Dependency inversion**: Commands inject services via `createServices()` method
- **Testability**: Override `createServices()` in test subclasses to inject mocks
- **Use cases** may still exist for legacy patterns, but new features should orchestrate directly in commands

### Core Layer (`src/core/`)

**Domain Entities** (`domain/entities/`):
- All entities have `toJson()`/`fromJson()` for serialization
- Immutable, readonly properties
- `AuthToken` has `sessionKey` used for `x-byterover-session-id` header
- `Memory` contains `bulletId`, `section`, `tags`, `metadataType`, `timestamp`, `nodeKeys`, relationship tracking
- `Playbook` manages bullets with section grouping, supports delta operations

**Interfaces** (`interfaces/`):
- Define contracts for dependency inversion
- All API services require both `accessToken` + `sessionKey` parameters
- List methods support `{fetchAll: true}` for auto-pagination OR `{limit, offset}` for manual control

### Infrastructure Layer (`src/infra/`)

**AuthenticatedHttpClient** (`infra/http/`):
- Auto-injects both `Authorization: Bearer {token}` AND `x-byterover-session-id: {sessionKey}` headers
- All HTTP service classes instantiate this client with both credentials

**API Service Pattern**:
```typescript
const client = new AuthenticatedHttpClient(accessToken, sessionKey)
// Client automatically adds both auth headers to all requests
```

**Memory-to-Playbook Mapper** (`infra/memory/memory-to-playbook-mapper.ts`):
- Pure functional transformations: `Memory` → `Bullet`, `RetrieveResult` → `Playbook`
- Maps `bulletId` → `id`, `tags` → `metadata.tags`, `nodeKeys` → `metadata.relatedFiles`

## File System Structure

```
.br/
  config.json              # Team/space selection from `br init`
  ace/
    playbook.json          # Living knowledge base
    executor-outputs/      # Task execution records
    reflections/           # Agent feedback analysis
    deltas/                # Playbook update operations
```

## Development Workflow

### Building & Testing

```bash
npm run build                                    # Compile TypeScript to dist/
npm test                                         # Run all tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
./bin/dev.js [command]                          # Dev mode (ts-node)
./bin/run.js [command]                          # Prod mode (compiled)
```

**Test directories**: `test/commands/` (integration), `test/unit/` (unit), `test/learning/` (exploration)

### Command Testing Pattern

```typescript
class TestableCommand extends MyCommand {
  constructor(mockService, config) {
    super([], config)
    this.mockService = mockService
  }
  
  protected createServices() {
    return { myService: this.mockService }
  }
  
  // Override prompt methods for interactive tests
  protected async promptForSelection(items) {
    return this.mockSelection
  }
  
  // Suppress output for clean test runs
  public log() {
    // Do nothing
  }
}
```

**Test output suppression**: Override `log()` and stub `ux.action.start/stop` to prevent noisy output.

### HTTP Testing with Nock

- Mock axios requests: `nock('https://api.example.com').get('/endpoint')`
- **Always verify both auth headers**: `.matchHeader('authorization', ...)` AND `.matchHeader('x-byterover-session-id', ...)`
- For `HttpSpaceService`, verify `team_id` query parameter
- Mock API responses must include all required entity fields

### Testing Services & Transformations

- Test pure transformation functions directly with domain entities
- Verify defensive array copying (returned arrays !== input arrays)
- For `PlaybookStore` tests: stub `clear()` and `save()` with `.resolves()`, verify call order with `calledBefore()`
- Commands orchestrate services - test by mocking service interfaces via `createServices()`

## TypeScript Configuration

- **Module system**: ES2022 with Node16 module resolution
- **Strict mode**: All type checks enabled
- **File extensions**: MUST use `.js` extensions in imports (even for `.ts` files) due to Node16 module resolution
  ```typescript
  import {MyClass} from './my-file.js'  // ✅ Correct
  import {MyClass} from './my-file'     // ❌ Wrong
  ```

## Key Command Workflows

### `br login` - OAuth 2.0 + PKCE

1. OIDC discovery for endpoints
2. Start local callback server on random port
3. Generate PKCE parameters + state (handled internally by `OAuthService`)
4. Open browser for authorization
5. Exchange code for token
6. Store `AuthToken` (with `sessionKey`) in keychain

### `br init` - Project Setup

1. Fetch all teams with `{fetchAll: true}` → user selects
2. Fetch all spaces for team → user selects
3. Save to `.br/config.json`
4. Initialize ACE directory structure and empty playbook

**Always use `fetchAll: true`** for complete lists in interactive selection contexts.

### `br space switch` - Change Team/Space

1. Requires project init (shows current team/space from config)
2. Fetch all teams → user selects
3. Fetch spaces for selected team → user selects
4. Update `.br/config.json`

**No playbook initialization** (unlike `br init`).

### `br mem retrieve` - Memory Retrieval

1. Validate auth + project init (get `spaceId` from config)
2. Fetch memories from Memora API (optional `--node-keys` for scoped search)
3. **Clear existing playbook** (fail-safe: warns on save error but still displays results)
4. Transform `RetrieveResult` → `Playbook` using mapper (combines `memories` + `relatedMemories`)
5. Save to `.br/ace/playbook.json`
6. Display results

### `br mem push` - Memory Upload

1. Validate auth + project init + playbook exists
2. Request presigned URLs from cogit API
3. Upload playbook to GCS (HTTP PUT, `application/json`, NO auth headers)
4. **Confirm upload** (POST with `request_id`)
5. **Cleanup** (only after successful confirmation):
   - Clear playbook (replace with empty)
   - Remove files from `executor-outputs/`, `reflections/`, `deltas/`

**Fail-fast**: Cleanup only after upload + confirmation succeed.

### ACE Workflow (`br ace complete`)

Automated 3-phase cycle:

1. **Executor**: Save work to `executor-outputs/` with hint, reasoning, tool usage, bullet IDs
2. **Reflector**: Auto-generate reflection from feedback → `reflections/`
3. **Curator**: Auto-generate delta operations, apply to playbook → `deltas/`

**Two modes**:
- **ADD mode** (default): Creates new bullet in "Lessons Learned" section
- **UPDATE mode** (`--update-bullet`): Updates existing bullet (validates ID exists first)

**Non-interactive**: No stdin required, fully automated pipeline.

## Conventions & Patterns

### Pagination

All list methods accept:
- `{fetchAll: true}` - Auto-paginate with 100-item internal pages
- `{limit: n, offset: n}` - Manual pagination control

### Error Handling

- Custom domain errors: `AuthenticationError`, `TokenExpiredError`, `DiscoveryError`, etc.
- Services throw errors or return typed responses
- Commands use `this.error()` for fatal errors (exits process)
- Commands handle service errors and present user-friendly messages

### Configuration

**Runtime environment** (`src/config/environment.ts`):
- Set by launcher scripts (`bin/dev.js`, `bin/run.js`)
- Development: `https://dev-beta-*.byterover.dev/api/*`
- Production: `https://prod-beta-*.byterover.dev/api/*`

### Prompts

Use `@inquirer/prompts` for interactive selection:
```typescript
import {select} from '@inquirer/prompts'

const choice = await select({
  message: 'Select an option',
  choices: items.map(item => ({name: item.name, value: item.id}))
})
```

## Common Pitfalls

1. **Missing auth headers**: `AuthenticatedHttpClient` requires BOTH `accessToken` AND `sessionKey`
2. **Import extensions**: Always use `.js` extensions in imports (Node16 module resolution requirement)
3. **Pagination**: Use `fetchAll: true` for complete lists in user-facing contexts
4. **Upload flow**: Must call confirm endpoint after GCS upload, cleanup only after confirmation succeeds
5. **Playbook operations**: Always validate playbook exists before read operations
6. **Test mocking**: Override `createServices()` AND interactive prompt methods when testing commands
7. **Memory mapping**: Use `transformRetrieveResultToPlaybook()` for complete transformation, not manual mapping

## References

- [docs/ACE_AGENT_GUIDE.md](../docs/ACE_AGENT_GUIDE.md) - Complete ACE workflow guide for coding agents
- [README.md](../README.md) - User-facing documentation and quick start
