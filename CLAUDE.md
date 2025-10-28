# CLAUDE.md

ByteRover CLI (`br`) - oclif-based TypeScript CLI using Clean Architecture.

## Development Commands

```bash
npm run build                                    # Compile to dist/
npm test                                         # Run all tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
npm run lint                                     # ESLint check
./bin/dev.js [command]                          # Dev mode (ts-node)
./bin/run.js [command]                          # Prod mode (compiled)
npx oclif generate command                       # Create new command
```

**Test directories**: `test/commands/` (integration), `test/unit/` (unit tests), `test/learning/` (exploration)

## Architecture

**Clean Architecture with pragmatic CLI adaptations**:

- Use cases for complex orchestration with framework independence
- Commands orchestrate directly for UI-driven, linear flows

### Core Layer (`src/core/`)

**Domain Entities** (`domain/entities/`):

- `AuthToken` - OAuth tokens with `sessionKey` for `x-byterover-session-id` header
- `User`, `Team`, `Space` - Organizational entities with `getDisplayName()` methods
- `Memory` - Memora memories with `bulletId`, `section`, `tags`, `metadataType`, `timestamp`, `nodeKeys`, `score`, relationships (`parentIds`, `childrenIds`)
- `RetrieveResult` - Contains `memories` and `relatedMemories` arrays
- `PresignedUrl`, `PresignedUrlsResponse` - Blob storage upload structures
- **Pattern**: All entities have `toJson()`/`fromJson()` for serialization, immutable, readonly properties

**Domain Errors** (`domain/errors/`):

- `AuthenticationError`, `TokenExpiredError`, `InvalidTokenError`
- `DiscoveryError`, `DiscoveryTimeoutError`, `DiscoveryNetworkError`

**Interfaces** (`interfaces/` - dependency inversion):

Core services:

- `IAuthService` - OAuth with PKCE, returns `AuthorizationContext`
- `ITokenStore` - Token persistence (keychain)
- `ICallbackHandler` - OAuth callback server
- `IOidcDiscoveryService` - OIDC discovery
- `IHttpClient` - Authenticated HTTP with auto-injection of `Authorization` and `x-byterover-session-id` headers

API services (all require `accessToken` + `sessionKey`):

- `ITeamService.getTeams(accessToken, sessionKey, {fetchAll?, isActive?, limit?, offset?})` → `{teams, total}`
- `ISpaceService.getSpaces(accessToken, sessionKey, teamId, {fetchAll?, limit?, offset?})` → `{spaces, total}`
- `IUserService.getCurrentUser(accessToken, sessionKey)` → `User`
- `IMemoryRetrievalService.retrieve({query, spaceId, accessToken, sessionKey, nodeKeys?})` → `RetrieveResult`
- `IMemoryStorageService`:
  - `getPresignedUrls({accessToken, sessionKey, teamId, spaceId, branch, fileNames})` → `PresignedUrlsResponse`
  - `uploadFile(uploadUrl, content)` - Plain HTTP PUT, no auth headers
  - `confirmUpload({accessToken, sessionKey, teamId, spaceId, requestId})` - Must call after upload

Storage:

- `IPlaybookStore` - `clear()`, `delete()`, `exists()`, `load()`, `save()`
- `IProjectConfigStore` - Project config persistence

**Pagination pattern**: All list methods support `{fetchAll: true}` for auto-pagination or `{limit, offset}` for manual control.

### Infrastructure Layer (`src/infra/`)

**Key implementations**:

- `OAuthService` - OAuth 2.0 + PKCE, manages `code_verifier` internally
- `AuthenticatedHttpClient` - Auto-injects both auth headers (`Authorization: Bearer` + `x-byterover-session-id`)
- `Http*Service` classes - All use `AuthenticatedHttpClient`, map API responses to domain entities
- `CallbackServer` - Local OAuth callback with force-close of keep-alive connections

**API service patterns**:

- All services instantiate `AuthenticatedHttpClient` with `accessToken` + `sessionKey`
- Auto-pagination uses 100-item internal pages
- Configuration: `{apiBaseUrl: string, timeout?: number}`

**Memory-to-Playbook Mapper** (`infra/memory/memory-to-playbook-mapper.ts`):

- `transformMemoryToBullet(memory)` - Maps `Memory` → `Bullet` (functional, pure)
- `transformRetrieveResultToPlaybook(result)` - Maps `RetrieveResult` → `Playbook` (combines memories + relatedMemories, sets `nextId=1`)
- Mapping: `bulletId` → `id`, `tags` → `metadata.tags`, `nodeKeys` → `metadata.relatedFiles`, `timestamp` → `metadata.timestamp`

### Utilities (`src/utils/`)

**`ace-file-helpers.ts`**:

- `clearDirectory(dirPath)` - Removes files only (preserves dirs), returns count, handles ENOENT gracefully
- `findMostRecentFile()`, `loadExecutorOutput()`, `loadReflectorOutput()`, `loadDeltaBatch()`, `sanitizeHint()`

### Configuration (`src/config/`)

**`environment.ts`** - Runtime env config (set by launcher scripts):

- Development: `https://dev-beta-*.byterover.dev/api/*`
- Production: `https://prod-beta-*.byterover.dev/api/*`
- Contains: `issuerUrl`, `clientId`, `scopes`, `apiBaseUrl`, `cogitApiBaseUrl`, `memoraApiBaseUrl`

**`auth.config.ts`** - OIDC discovery with hardcoded fallback

### Commands (`src/commands/`)

**Dependency Injection Pattern**:

```typescript
protected createServices(): {myService: IMyService} {
  return {myService: new MyServiceImpl()}
}
```

**Testing**: Subclass overrides `createServices()` to inject mocks.

**Key Commands**:

`br login`:

- OAuth 2.0 + PKCE flow with local callback server
- Stores `AuthToken` (with `sessionKey`) to keychain

`br init`:

1. Fetch all teams → user selects
2. Fetch spaces for selected team → user selects
3. Save to `.br/config.json`
4. Initialize ACE playbook

- Uses `@inquirer/prompts` for selection
- Always uses `{fetchAll: true}` for complete lists

`br mem retrieve --query <q> [--node-keys <paths>]`:

1. Requires project init (gets `spaceId` from config)
2. Fetch memories from Memora API (optional `nodeKeys` for scoped search)
3. Clear existing playbook
4. Transform `RetrieveResult` → `Playbook` using mapper
5. Save to `.br/ace/playbook.json`
6. Display results to console

- Combines both `memories` and `relatedMemories` into playbook
- Overwrites existing playbook content (fail-safe: warns on save error but still displays results)
- Uses Memora `tags` directly (not "auto-generated")

`br mem push [--branch <name>]`:

1. Validate auth + project init + playbook exists
2. Request presigned URLs from cogit API
3. Upload playbook to GCS (HTTP PUT, application/json)
4. **Confirm upload** (POST with `request_id`)
5. **Cleanup** (only after successful confirmation):
   - Clear playbook (replace with empty)
   - Remove files from executor-outputs/, reflections/, deltas/

- Default branch: `main` (ByteRover internal, not git)
- Fail-fast: Cleanup only after upload + confirmation succeed

`br space list [--all] [--limit <n>] [--offset <n>] [--json]`:

- Requires project init (gets `teamId` from config)
- Default: 50 items, shows pagination hint if more exist

## Key Technologies

- **oclif v4**, **TypeScript** (ES2022, Node16 modules, strict mode)
- **axios** (HTTP), **express** (OAuth callback), **@inquirer/prompts** (interactive selection)
- **Mocha + Chai + Sinon + Nock** (testing)

## Testing Patterns

**Command testing**:

- Subclass pattern: Override `createServices()` to inject mocks
- Override `promptForTeamSelection()` / `promptForSpaceSelection()` for interactive prompt testing
- See: `test/commands/init.test.ts`

**HTTP mocking**:

- Use `nock` to intercept axios requests
- Verify headers: `.matchHeader('authorization', ...)` and `.matchHeader('x-byterover-session-id', ...)`
- For `HttpSpaceService`, verify `team_id` query parameter
- For `HttpMemoryRetrievalService`, mock API responses must include all required Memory fields: `bullet_id`, `section`, `tags`, `metadata_type`, `timestamp`, `node_keys`, etc.
- See: `test/unit/infra/http/authenticated-http-client.test.ts`, `test/unit/infra/memory/http-memory-retrieval-service.test.ts`

**Service mocking**:

- Verify all parameters: `expect(service.method.calledWith('token', 'session', 'id', {fetchAll: true})).to.be.true`
- For `PlaybookStore` in retrieve command tests: stub `clear()` and `save()` with `.resolves()`, verify call order with `calledBefore()`

**Mapper testing**:

- Test pure transformation functions directly with domain entities
- Verify defensive array copying (returned arrays !== input arrays)
- Test edge cases: empty results, multiple sections, section grouping
- See: `test/unit/infra/memory/memory-to-playbook-mapper.test.ts`

**ES Module limitations**:

- Cannot stub ES module exports with `sinon.stub(module, 'function')`
- Test utility functions in isolation with real file system (use `tmpdir()`)
- In integration tests, verify interface calls instead (e.g., `playbookStore.clear()` called, not `clearDirectory()`)

## TypeScript Configuration

- ES modules: `"type": "module"`, all imports require `.js` extension
- Strict mode, output to `dist/`, source in `src/`

## OAuth Flow

1. OIDC discovery → 2. Start callback server → 3. Build `redirectUri` (dynamic port) → 4. Generate PKCE params (internal) → 5. Launch browser → 6. Wait for callback → 7. Exchange code for tokens → 8. Parse response (includes `session_key`) → 9. Store to keychain → 10. Cleanup

**Key details**:

- `OAuthService` manages `code_verifier` internally, returns `AuthorizationContext` (hides PKCE details)
- `redirectUri` built after server starts: `http://localhost:{port}/callback`
- `session_key` from token response stored in `AuthToken.sessionKey`
- Callback server force-closes connections to prevent keep-alive delays
- State parameter: cryptographically secure CSRF protection

### Authenticated API Requests

**Flow**: Commands load `AuthToken` → extract `accessToken` + `sessionKey` → pass to service → service creates `AuthenticatedHttpClient` → client auto-injects both headers

**Headers**:

- `Authorization: Bearer {accessToken}`
- `x-byterover-session-id: {sessionKey}`

## Environment Variables

**Runtime** (set by launchers):

- `BR_ENV` - `development` | `production`

**Plugin config**:

- `BR_NPM_LOG_LEVEL`, `BR_NPM_REGISTRY`

## Code Style

- Explicit access modifiers, `const` for variables, arrow functions for methods
- Interface names: `I` prefix (e.g., `IAuthService`)
- Snake_case APIs: `/* eslint-disable camelcase */`
- Entity serialization: `toJSON()` / `fromJSON()`

## OIDC Discovery

- Endpoint: `{issuerUrl}/.well-known/openid-configuration`
- 1-hour cache, 3 retries with exponential backoff, 5s timeout, hardcoded fallback

## Distribution

```bash
npm run pack:dev   # Development tarball
npm run pack:prod  # Production tarball
```

## Plugin System

oclif plugins via `@oclif/plugin-plugins` - `br plugins` command namespace
