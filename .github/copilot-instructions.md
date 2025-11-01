# ByteRover CLI - Copilot Instructions

**oclif v4 TypeScript CLI** (`br`) with Clean Architecture + ACE (Agentic Context Engineering)

## Architecture

**Layers**: Commands → Services (infra) → Core (entities/interfaces)

**Entities** (`src/core/domain/entities/`):
- `AuthToken`: `accessToken`, `sessionKey`, `userId`, `userEmail`
- `Memory`: `bulletId`, `section`, `tags`, `metadataType`, `timestamp`, `nodeKeys`
- `Playbook`: Bullets with sections, delta operations
- All: `toJson()`/`fromJson()`, immutable readonly

**HTTP Auth**: `AuthenticatedHttpClient` auto-injects:
```typescript
Authorization: Bearer {accessToken}
x-byterover-session-id: {sessionKey}
```
All API services require BOTH `accessToken` + `sessionKey`.

**Pagination**:
- `{fetchAll: true}` - Auto-paginate (UI selections)
- `{limit, offset}` - Manual

## TypeScript Rules

**MUST use `.js` in imports** (Node16 resolution):
```typescript
import {MyClass} from './my-file.js'  // ✅
import {MyClass} from './my-file'     // ❌
```

## Command Workflows

### `br login`
OIDC → callback server → browser → token exchange → keychain

### `br init`
Fetch teams (`fetchAll`) → select → fetch spaces → select → save `.br/config.json` → init ACE

### `br space switch`
Load config → select team/space → update `.br/config.json` (no ACE init)

### `br retrieve`
Validate → fetch memories (optional `--node-keys`) → **clear playbook** → transform via mapper → save

### `br push`
Validate → request presigned URLs → upload to GCS (PUT, `application/json`, **NO auth headers**) → confirm (POST) → cleanup (clear playbook, remove `executor-outputs/`, `reflections/`, `deltas/`)

### `br ace` (3-Phase)
1. **Executor** → `executor-outputs/` (hint, reasoning, answer, tool usage, bullet IDs)
2. **Reflector** → `reflections/` (feedback analysis) → apply tags to playbook
3. **Curator** → `deltas/` + apply
   - ADD: new bullet in "Lessons Learned"
   - UPDATE: `--update-bullet <id>` validates ID exists

## Testing

**Build/Run**:
```bash
npm run build                                    # Compile
npm test                                         # All tests
npx mocha --forbid-only "test/path/file.test.ts" # Single
./bin/dev.js [cmd]                              # Dev
./bin/run.js [cmd]                              # Prod
```

**Command Test Pattern**:
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
    return this.mockSelection  // Override
  }
  public log() {} // Suppress
}
```

**Nock HTTP**:
- Verify BOTH: `.matchHeader('authorization', ...)` AND `.matchHeader('x-byterover-session-id', ...)`
- `HttpSpaceService`: verify `team_id` query param
- Mock responses: include all required entity fields

**Service Tests**:
- Test transformations with domain entities
- Verify defensive array copying (returned !== input)
- Stub `PlaybookStore`: `.resolves()`, verify `calledBefore()`

## Patterns

**Prompts**:
```typescript
import {select} from '@inquirer/prompts'
const choice = await select({
  message: 'Select',
  choices: items.map(i => ({name: i.name, value: i.id}))
})
```

**Env URLs**:
- Dev: `https://dev-beta-*.byterover.dev/api/*`
- Prod: `https://prod-beta-*.byterover.dev/api/*`

## Critical Rules

1. **Auth**: BOTH `accessToken` AND `sessionKey` required
2. **Imports**: Use `.js` extensions (Node16)
3. **Pagination**: `fetchAll: true` for UI
4. **Upload**: Confirm before cleanup, fail-fast
5. **Test mocking**: Override `createServices()` AND prompts
6. **Transformations**: Use `transformRetrieveResultToPlaybook()`
