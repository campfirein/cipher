# CLAUDE.md

ByteRover CLI (`brv`) - oclif TypeScript CLI with Clean Architecture

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

- Commands: UI-driven linear flows

### Core Interfaces (`src/core/interfaces/`)

**Auth** (all require `accessToken` + `sessionKey`):

- `IAuthService` - OAuth + PKCE → `AuthorizationContext`
- `ITokenStore` - Keychain persistence
- `IHttpClient` - Auto-injects `Authorization: Bearer` + `x-byterover-session-id`

**API Services**:

- `ITeamService.getTeams(accessToken, sessionKey, {fetchAll?, isActive?, limit?, offset?})` → `{teams, total}`
- `ISpaceService.getSpaces(accessToken, sessionKey, teamId, {fetchAll?, limit?, offset?})` → `{spaces, total}`
- `IUserService.getCurrentUser(accessToken, sessionKey)` → `User`
- `IMemoryRetrievalService.retrieve({query, spaceId, accessToken, sessionKey, nodeKeys?})` → `RetrieveResult`
- `IMemoryStorageService`:
  - `getPresignedUrls(...)` → `PresignedUrlsResponse`
  - `uploadFile(uploadUrl, content)` - Plain HTTP PUT, **no auth headers**
  - `confirmUpload(...)` - **Must call after upload**

**Storage**:

- `IContextTreeService` - Context tree operations
- `IContextTreeSnapshotService` - Snapshot and change tracking
- `IPlaybookStore` - **DEPRECATED** - Legacy playbook interface
- `IProjectConfigStore` - `.brv/config.json` persistence

**Pagination**: `{fetchAll: true}` auto-paginates (100/page) or `{limit, offset}` manual

### Domain Entities (`src/core/domain/entities/`)

All have `toJSON()`/`fromJSON()`, immutable readonly properties

- `AuthToken` - `accessToken`, `refreshToken`, `sessionKey`, `userId`, `userEmail`. `fromJson()` returns `undefined` for old tokens (forces re-login)
- `OAuthTokenData` - OAuth response, no user info. Used before user fetch in login
- `User`, `Team`, `Space` - `getDisplayName()` methods
- `Memory` - **DEPRECATED** - Legacy memory entity with `bulletId`, `section`, `tags`
- `RetrieveResult` - **DEPRECATED** - Legacy retrieval result

### Infrastructure (`src/infra/`)

- `OAuthService` - Manages `code_verifier` internally
- `CallbackServer` - Force-closes keep-alive connections
- `AuthenticatedHttpClient` - Auto-injects both auth headers
- `FileContextTreeService` - File-based context tree operations
- `FileContextTreeSnapshotService` - Git-style snapshot and diff tracking
- **Legacy Memory Mapper** (`infra/memory/memory-to-playbook-mapper.ts`) - **DEPRECATED**

### Utilities

- `clearDirectory(dirPath)` (`src/utils/ace-file-helpers.ts`) - **DEPRECATED** - Legacy ACE helper

### Config

- `environment.ts` - Dev: `https://dev-beta-*.byterover.dev/api/*`, Prod: `https://prod-beta-*.byterover.dev/api/*`. Exports: `issuerUrl`, `clientId`, `scopes`, `apiBaseUrl`, `cogitApiBaseUrl`, `memoraApiBaseUrl`
- `auth.config.ts` - OIDC discovery (1h cache, 3 retries, 5s timeout, hardcoded fallback)

### Commands

**DI Pattern**:

```typescript
protected createServices(): {myService: IMyService} {
  return {myService: new MyServiceImpl()}
}
```

**Behaviors**:

- `brv login` - OAuth: code → user → AuthToken. `fromJson()` forces re-login for old tokens
- `brv status` - Reads `userEmail` from AuthToken (no API). Shows: version, auth, directory, config, context tree changes
- `brv init` - `{fetchAll: true}` for teams/spaces, initializes context tree
- `brv add` - Interactive or autonomous mode to add context to context tree
- `brv space switch` - **No context tree init**
- `brv push [--branch <name>]` - Default: `main` (ByteRover, not git). Snapshots context tree and pushes to cloud
- `brv space list` - Default 50, needs `--all` or manual pagination

**OAuth Flow**:

- `redirectUri`: `http://localhost:{port}/callback` (built after server starts)
- Login: `OAuthTokenData` → fetch User → `AuthToken` with `userId`/`userEmail`
- `session_key` → `AuthToken.sessionKey`
- Authenticated requests: AuthToken → `accessToken` + `sessionKey` → service → `AuthenticatedHttpClient` injects headers

## Testing

**Commands**:

- Override `createServices()` for mocks
- Override `promptForTeamSelection()` / `promptForSpaceSelection()`
- **Suppress output**: `log()` no-op, `warn()` return input, `error()` throw without console, stub `ux.action.start/stop`. See [login.test.ts:51-65](test/commands/login.test.ts#L51-L65), [init.test.ts:82-94](test/commands/init.test.ts#L82-L94)

**HTTP (nock)**:

- Verify headers: `.matchHeader('authorization', ...)` + `.matchHeader('x-byterover-session-id', ...)`
- `HttpSpaceService`: verify `team_id` query param
- `HttpMemoryRetrievalService`: `memories` have all fields, `related_memories` omit `score`, `parent_ids`, `children_ids`

**Services**:

- Verify all params: `expect(service.method.calledWith('token', 'session', 'id', {fetchAll: true})).to.be.true`
- `ContextTreeService`: stub with `.resolves()`, verify file operations
- `PlaybookStore`: **DEPRECATED** - Legacy testing patterns

**Mappers**:

- Test pure functions directly
- Verify defensive copying (returned !== input)

**ES Modules**:

- Cannot stub ES exports with sinon
- Test utils with real filesystem (`tmpdir()`)
- Integration: verify interface calls, not implementation

## Conventions

- ES modules: `"type": "module"`, **imports need `.js` extension**
- Interface names: `I` prefix
- Snake_case APIs: `/* eslint-disable camelcase */`
- Entity serialization: `toJson()` / `fromJson()` (capital J)

## Environment

- `BR_ENV` - `development` | `production`
- `BR_NPM_LOG_LEVEL`, `BR_NPM_REGISTRY`

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), axios, express, @inquirer/prompts, Mocha + Chai + Sinon + Nock
