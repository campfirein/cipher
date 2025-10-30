# CLAUDE.md

ByteRover CLI (`br`) - oclif TypeScript CLI with Clean Architecture

## Dev Commands

```bash
npm run build                                    # Compile to dist/
npm test                                         # All tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
npm run lint                                     # ESLint
./bin/dev.js [command]                          # Dev mode (ts-node)
./bin/run.js [command]                          # Prod mode
npx oclif generate command                       # New command
npm run pack:dev / pack:prod                     # Tarballs
```

**Test dirs**: `test/commands/` (integration), `test/unit/`, `test/learning/`

## Architecture

**Clean Architecture with pragmatic CLI adaptations**:

- Use cases for complex orchestration with framework independence
- Commands orchestrate directly for UI-driven, linear flows

### Core Interfaces (`src/core/interfaces/`)

**Auth & Core Services**:

- `IAuthService` - OAuth + PKCE, returns `AuthorizationContext`
- `ITokenStore` - Keychain persistence
- `IHttpClient` - Auto-injects `Authorization: Bearer` + `x-byterover-session-id` headers

**API Services** (all require `accessToken` + `sessionKey`):

- `ITeamService.getTeams(accessToken, sessionKey, {fetchAll?, isActive?, limit?, offset?})` → `{teams, total}`
- `ISpaceService.getSpaces(accessToken, sessionKey, teamId, {fetchAll?, limit?, offset?})` → `{spaces, total}`
- `IUserService.getCurrentUser(accessToken, sessionKey)` → `User`
- `IMemoryRetrievalService.retrieve({query, spaceId, accessToken, sessionKey, nodeKeys?})` → `RetrieveResult`
- `IMemoryStorageService`:
  - `getPresignedUrls(...)` → `PresignedUrlsResponse`
  - `uploadFile(uploadUrl, content)` - Plain HTTP PUT, **no auth headers**
  - `confirmUpload(...)` - **Must call after upload**

**Storage**:

- `IPlaybookStore` - `clear()`, `delete()`, `exists()`, `load()`, `save()`
- `IProjectConfigStore` - `.br/config.json` persistence

**Pagination**: All list methods support `{fetchAll: true}` (auto-paginates with 100-item pages) or `{limit, offset}` manual

### Domain Entities (`src/core/domain/entities/`)

**Pattern**: All entities have `toJSON()`/`fromJSON()`, immutable readonly properties

- `AuthToken` - Has `sessionKey` for `x-byterover-session-id` header
- `User`, `Team`, `Space` - Have `getDisplayName()` methods
- `Memory` - Key fields: `bulletId`, `section`, `tags`, `metadataType`, `timestamp`, `nodeKeys`, `score`, `parentIds`, `childrenIds`
- `RetrieveResult` - Contains `memories` and `relatedMemories` arrays

### Infrastructure (`src/infra/`)

**Key behaviors**:

- `OAuthService` - Manages `code_verifier` internally, hides PKCE details
- `CallbackServer` - Force-closes keep-alive connections
- `AuthenticatedHttpClient` - Auto-injects both auth headers
- `HttpMemoryRetrievalService` - Maps API snake_case to domain entities

**Memory-to-Playbook Mapper** (`infra/memory/memory-to-playbook-mapper.ts`):

- `transformMemoryToBullet(memory)` - Pure function: `Memory` → `Bullet`
- `transformRetrieveResultToPlaybook(result)` - Combines `memories` + `relatedMemories`, sets `nextId = bulletsMap.size + 1`
- Mapping: `bulletId` → `id`, `tags` → `metadata.tags`, `nodeKeys` → `metadata.relatedFiles`, `timestamp` → `metadata.timestamp`

### Utilities (`src/utils/ace-file-helpers.ts`)

- `clearDirectory(dirPath)` - **Removes files only** (preserves dirs), handles ENOENT gracefully

### Config (`src/config/`)

**`environment.ts`** - Runtime config (set by launchers):

- Dev: `https://dev-beta-*.byterover.dev/api/*`
- Prod: `https://prod-beta-*.byterover.dev/api/*`
- Exports: `issuerUrl`, `clientId`, `scopes`, `apiBaseUrl`, `cogitApiBaseUrl`, `memoraApiBaseUrl`

**`auth.config.ts`** - OIDC discovery (1h cache, 3 retries, 5s timeout, hardcoded fallback)

### Commands (`src/commands/`)

**DI Pattern** (for testability):

```typescript
protected createServices(): {myService: IMyService} {
  return {myService: new MyServiceImpl()}
}
```

Test subclasses override to inject mocks.

**Key Command Behaviors**:

`br init`:

- Uses `{fetchAll: true}` for complete team/space lists
- Initializes ACE playbook

`br space switch`:

- **No playbook initialization** (unlike `init`)

`br mem retrieve --query <q> [--node-keys <paths>]`:

- Clears existing playbook first
- Combines `memories` + `relatedMemories` into playbook
- Uses Memora `tags` directly (not "auto-generated")
- Fail-safe: warns on save error but still displays results

`br mem push [--branch <name>]`:

- Default branch: `main` (ByteRover internal, not git)
- **Upload flow**: 1. Get presigned URLs → 2. PUT to GCS → 3. **Confirm** upload
- **Cleanup** (only after successful confirmation): Clear playbook, remove executor-outputs/, reflections/, deltas/
- Fail-fast: cleanup only after upload + confirmation succeed

`br space list`:

- Default 50 items, requires `--all` or manual pagination

## Testing Patterns

**Command testing**:

- Subclass overrides `createServices()` to inject mocks
- Override `promptForTeamSelection()` / `promptForSpaceSelection()` for prompts
- Suppress output: Override `log()`, stub `ux.action.start/stop`

**HTTP mocking** (nock):

- Verify both headers: `.matchHeader('authorization', ...)` + `.matchHeader('x-byterover-session-id', ...)`
- `HttpSpaceService`: verify `team_id` query param
- `HttpMemoryRetrievalService`: mocks must include all Memory fields (`bullet_id`, `section`, `tags`, `metadata_type`, `timestamp`, `node_keys`, etc.)

**Service mocking**:

- Verify all params: `expect(service.method.calledWith('token', 'session', 'id', {fetchAll: true})).to.be.true`
- `PlaybookStore`: stub with `.resolves()`, verify call order with `calledBefore()`

**Mapper testing**:

- Test pure functions directly
- Verify defensive array copying (returned !== input)

**ES Module gotcha**:

- Cannot stub ES module exports with sinon
- Test utilities with real filesystem (use `tmpdir()`)
- Integration tests: verify interface calls, not implementation

## Code Conventions

- ES modules: `"type": "module"`, **all imports need `.js` extension**
- Interface names: `I` prefix
- Snake_case APIs: `/* eslint-disable camelcase */`
- Entity serialization: `toJSON()` / `fromJSON()` (capital J)

## OAuth Flow

- `redirectUri` built after server starts: `http://localhost:{port}/callback`
- `session_key` from token response → stored in `AuthToken.sessionKey`
- Callback server force-closes connections
- State param for CSRF protection

**Authenticated requests**: Commands load `AuthToken` → extract `accessToken` + `sessionKey` → pass to service → `AuthenticatedHttpClient` auto-injects headers

## Environment Variables

- `BR_ENV` - `development` | `production` (set by launchers)
- `BR_NPM_LOG_LEVEL`, `BR_NPM_REGISTRY` (plugin config)

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), axios, express, @inquirer/prompts, Mocha + Chai + Sinon + Nock
