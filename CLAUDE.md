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

**CoGit Services** (context sync):

- `ICogitPushService.pushContexts(...)` - Push context tree to ByteRover cloud
- `ICogitPullService.pullSnapshot(...)` - Pull snapshot from cloud

**Context Tree**:

- `IContextTreeService` - Initialize/check context tree existence
- `IContextTreeSnapshotService` - Snapshot and change tracking
- `IContextTreeWriterService` - Write/sync context files from pull
- `IContextFileReader` - Read context files with metadata extraction
- `IProjectConfigStore` - `.brv/config.json` persistence

**Pagination**: `{fetchAll: true}` auto-paginates (100/page) or `{limit, offset}` manual

### Domain Entities (`src/core/domain/entities/`)

All have `toJSON()`/`fromJSON()`, immutable readonly properties

- `AuthToken` - `accessToken`, `refreshToken`, `sessionKey`, `userId`, `userEmail`, `expiresAt`. `fromJson()` returns `undefined` for old tokens (forces re-login)
- `OAuthTokenData` - OAuth response, no user info. Used before user fetch in login
- `User`, `Team`, `Space` - `getDisplayName()` methods
- `Agent` - 18 supported agents (Claude Code, Cursor, Windsurf, Copilot, etc.)
- `BrvConfig` - `.brv/config.json` with version validation (`BRV_CONFIG_VERSION = '0.0.1'`)
- `CogitSnapshot`, `CogitPushContext` - CoGit sync entities

### Infrastructure (`src/infra/`)

**Auth/HTTP**:

- `OAuthService` - Manages `code_verifier` internally
- `CallbackServer` - Force-closes keep-alive connections
- `AuthenticatedHttpClient` - Auto-injects both auth headers

**Context Tree**:

- `FileContextTreeService` - File-based context tree operations
- `FileContextTreeSnapshotService` - Git-style snapshot and diff tracking
- `FileContextTreeWriterService` - Sync files from CoGit pull

**CoGit**:

- `HttpCogitPushService` - Push contexts to cloud
- `HttpCogitPullService` - Pull snapshots from cloud
- `context-tree-to-push-context-mapper.ts` - Maps context tree to push format

**Rules**:

- `RuleTemplateService` - Load rule templates
- `RuleWriterService` - Write rules to agent-specific locations
- `agent-rule-config.ts` - Agent-specific rule file paths

### Config

- `environment.ts` - Dev/Prod URLs. Exports: `issuerUrl`, `clientId`, `scopes`, `apiBaseUrl`, `cogitApiBaseUrl`, `llmGrpcEndpoint`
- `auth.config.ts` - OIDC discovery (1h cache, 3 retries, 5s timeout, hardcoded fallback)
- `context-tree-domains.ts` - Context tree domain definitions

### Commands

**DI Pattern**:

```typescript
protected createServices(): {myService: IMyService} {
  return {myService: new MyServiceImpl()}
}
```

**Core Commands**:

- `brv login` - OAuth: code → user → AuthToken. `fromJson()` forces re-login for old tokens
- `brv logout` - Clear stored credentials
- `brv status` - Reads `userEmail` from AuthToken (no API). Shows: version, auth, directory, config, context tree changes
- `brv init` - `{fetchAll: true}` for teams/spaces, initializes context tree

**Context Operations**:

- `brv curate` - Interactive or autonomous mode to add context to context tree
- `brv push [--branch <name>] [--yes]` - Default: `main` (ByteRover, not git). Snapshots and pushes to cloud
- `brv pull [--branch <name>]` - Pull snapshot from cloud and sync to local context tree
- `brv gen-rules` - Generate agent-specific rule files from context tree

**Space Management**:

- `brv space list` - Default 50, needs `--all` or manual pagination
- `brv space switch` - Switch space (**no context tree init**)

**Dev-Only Commands** (require `BR_ENV=development`):

- `brv query` - Query context tree
- `brv watch` - Watch filesystem for changes, trigger parsing pipeline
- `brv cipher-agent run` - Interactive CipherAgent session
- `brv cipher-agent set-prompt` / `show-prompt` - Manage CipherAgent system prompts

**OAuth Flow**:

- `redirectUri`: `http://localhost:{port}/callback` (built after server starts)
- Login: `OAuthTokenData` → fetch User → `AuthToken` with `userId`/`userEmail`
- Authenticated requests: AuthToken → `accessToken` + `sessionKey` → `AuthenticatedHttpClient` injects headers

## Testing

**Commands**:

- Override `createServices()` for mocks
- Override `promptForTeamSelection()` / `promptForSpaceSelection()`
- **Suppress output**: `log()` no-op, `warn()` return input, `error()` throw without console, stub `ux.action.start/stop`. See [login.test.ts:51-65](test/commands/login.test.ts#L51-L65), [init.test.ts:82-94](test/commands/init.test.ts#L82-L94)

**HTTP (nock)**:

- Verify headers: `.matchHeader('authorization', ...)` + `.matchHeader('x-byterover-session-id', ...)`
- `HttpSpaceService`: verify `team_id` query param

**Services**:

- Verify all params: `expect(service.method.calledWith('token', 'session', 'id', {fetchAll: true})).to.be.true`
- `ContextTreeService`: stub with `.resolves()`, verify file operations

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

- `BR_ENV` - `development` | `production` (dev-only commands require `development`)
- `BR_NPM_LOG_LEVEL`, `BR_NPM_REGISTRY`

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), axios, express, @inquirer/prompts, better-sqlite3, @grpc/grpc-js, Mocha + Chai + Sinon + Nock
