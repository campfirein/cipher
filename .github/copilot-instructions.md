# ByteRover CLI - AI Agent Instructions

**oclif v4 TypeScript CLI** (`br`) with Clean Architecture, authentication, and ACE (Agentic Context Engineering).

## Architecture

### Structure
- **Commands** (`src/commands/`) - Orchestrate services via `createServices()` method
- **Services** (`src/infra/`) - Infrastructure implementations (HTTP, storage, auth)
- **Core** (`src/core/`) - Domain entities & interfaces

### Key Entities
- `AuthToken` - Has `sessionKey` for `x-byterover-session-id` header
- `Memory` - `bulletId`, `section`, `tags`, `metadataType`, `timestamp`, `nodeKeys`
- `Playbook` - Bullets with section grouping, delta operations
- All entities: `toJson()`/`fromJson()`, immutable readonly properties

### HTTP Client
`AuthenticatedHttpClient` auto-injects BOTH headers:
- `Authorization: Bearer {accessToken}`
- `x-byterover-session-id: {sessionKey}`

All API services require both `accessToken` + `sessionKey` parameters.

### Pagination
- `{fetchAll: true}` - Auto-paginate (use for UI selections)
- `{limit, offset}` - Manual control

## TypeScript Rules
- **MUST use `.js` extensions** in imports (Node16 module resolution)
  ```typescript
  import {MyClass} from './my-file.js'  // ✅ Correct
  import {MyClass} from './my-file'     // ❌ Wrong
  ```
- ES2022 with Node16, strict mode enabled

## Command Workflows

### `br login`
OIDC discovery → callback server → browser auth → token exchange → keychain storage

### `br init`
Fetch teams (`fetchAll: true`) → select → fetch spaces → select → save `.br/config.json` → init ACE structure

### `br space switch`
Load config → fetch teams → select → fetch spaces → select → update `.br/config.json` (no playbook init)

### `br mem retrieve`
Validate auth/init → fetch memories (optional `--node-keys`) → **clear playbook** → transform via mapper → save → display

### `br mem push`
Validate → request presigned URLs → upload to GCS (PUT, `application/json`, NO auth headers) → confirm (POST) → cleanup on success (clear playbook, remove `executor-outputs/`, `reflections/`, `deltas/`)

### ACE Workflow
**Executor** → `executor-outputs/` (hint, reasoning, tool usage, bullet IDs)
**Reflector** → `reflections/` (feedback analysis)
**Curator** → `deltas/` + apply (ADD mode: new bullet in "Lessons Learned" | UPDATE mode: `--update-bullet` validates ID)

## Testing

### Build & Run
```bash
npm run build                                    # Compile
npm test                                         # All tests
npx mocha --forbid-only "test/path/file.test.ts" # Single test
./bin/dev.js [cmd]                              # Dev (ts-node)
./bin/run.js [cmd]                              # Prod (compiled)
```

### Command Test Pattern
```typescript
class TestableCommand extends MyCommand {
  constructor(mockService, config) {
    super([], config)
    this.mockService = mockService
  }
  
  protected createServices() {
    return { myService: this.mockService }
  }
  
  protected async promptForSelection(items) {
    return this.mockSelection  // Override for tests
  }
  
  public log() {} // Suppress output
}
```

### Nock HTTP Mocking
- Verify BOTH headers: `.matchHeader('authorization', ...)` AND `.matchHeader('x-byterover-session-id', ...)`
- For `HttpSpaceService`: verify `team_id` query param
- Mock responses must include all required entity fields

### Service Tests
- Test transformations directly with domain entities
- Verify defensive array copying (returned !== input)
- Stub `PlaybookStore`: `.resolves()`, verify `calledBefore()` order

## Patterns

### Prompts
```typescript
import {select} from '@inquirer/prompts'
const choice = await select({
  message: 'Select',
  choices: items.map(i => ({name: i.name, value: i.id}))
})
```

### Environment
- Dev: `https://dev-beta-*.byterover.dev/api/*`
- Prod: `https://prod-beta-*.byterover.dev/api/*`

## Critical Rules

1. **Auth headers**: BOTH `accessToken` AND `sessionKey` required
2. **Imports**: Use `.js` extensions (Node16 requirement)
3. **Pagination**: `fetchAll: true` for UI selections
4. **Upload**: Confirm before cleanup, fail-fast if confirmation fails
5. **Test mocking**: Override `createServices()` AND prompt methods
6. **Transformations**: Use `transformRetrieveResultToPlaybook()`, not manual mapping
