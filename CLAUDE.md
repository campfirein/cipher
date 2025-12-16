# CLAUDE.md

ByteRover CLI (`brv`) - Interactive REPL with React/Ink TUI

## Dev Commands

```bash
npm run build                                    # Compile to dist/
npm test                                         # All tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
npm run lint                                     # ESLint
./bin/dev.js [command]                          # Dev mode (ts-node)
./bin/run.js [command]                          # Prod mode
```

**Test dirs**: `test/commands/`, `test/unit/`, `test/integration/`, `test/hooks/`, `test/learning/`

## Architecture

### REPL + TUI Architecture

- `brv` (no args) starts interactive REPL (`src/infra/repl/repl-startup.tsx`)
- React/Ink-based TUI (`src/tui/`) with streaming, dialogs, prompts
- Slash commands (`/command`) in `src/infra/repl/commands/`
- Few oclif commands remain: `status`, `curate`, `query`, `watch`, `cipher-agent/*`

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

- `ICogitPushService.pushContexts(...)` - Push context tree to cloud
- `ICogitPullService.pullSnapshot(...)` - Pull snapshot from cloud

**Context Tree**:

- `IContextTreeService` - Initialize/check context tree existence
- `IContextTreeSnapshotService` - Snapshot and change tracking
- `IContextTreeWriterService` - Write/sync context files from pull
- `IContextFileReader` - Read context files with metadata extraction
- `IProjectConfigStore` - `.brv/config.json` persistence

**Storage/Config**:

- `IGlobalConfigStore` - User-level config (`~/.config/brv/config.json`), device ID management
- `IOnboardingPreferenceStore` - Onboarding state persistence
- `ITrackingService` - Event tracking (Mixpanel implementation)

**Pagination**: `{fetchAll: true}` auto-paginates (100/page) or `{limit, offset}` manual

### Domain Entities (`src/core/domain/entities/`)

All have `toJson()`/`fromJson()`, immutable readonly properties

- `AuthToken` - `accessToken`, `refreshToken`, `sessionKey`, `userId`, `userEmail`, `expiresAt`. `fromJson()` returns `undefined` for old tokens (forces re-login)
- `OAuthTokenData` - OAuth response, no user info. Used before user fetch in login
- `User`, `Team`, `Space` - `getDisplayName()` methods
- `Agent` - Supported agents (Claude Code, Cursor, Windsurf, Copilot, etc.)
- `BrvConfig` - `.brv/config.json` with version validation
- `GlobalConfig` - User-level config with device ID
- `Event` - Tracking event definitions
- `CogitSnapshot`, `CogitPushContext` - CoGit sync entities

### Infrastructure (`src/infra/`)

**REPL** (`src/infra/repl/`):

- `repl-startup.tsx` - Bootstrap REPL with providers
- `commands/` - Slash command implementations (`/login`, `/push`, `/pull`, etc.)

**Cipher** (`src/infra/cipher/`) - LLM agent system:

- `llm/` - Multi-provider support (Claude, Gemini, OpenRouter), tokenizers, context compression
- `tools/` - Tool implementations (bash, file ops, memory, grep, glob)
- `session/` - Chat session management
- `memory/` - Memory persistence

**Auth/HTTP**:

- `OAuthService` - Manages `code_verifier` internally
- `CallbackServer` - Force-closes keep-alive connections

**Context Tree**:

- `FileContextTreeService` - File-based context tree operations
- `FileContextTreeSnapshotService` - Git-style snapshot and diff tracking

**CoGit**:

- `HttpCogitPushService` / `HttpCogitPullService` - Cloud sync
- `context-tree-to-push-context-mapper.ts` - Maps context tree to push format

**Tracking**:

- `MixpanelTrackingService` - Analytics implementation

### Config

- `environment.ts` - Dev/Prod config. Exports: `getCurrentConfig()`, `isDevelopment()`, `ENV_CONFIG`
- `auth.config.ts` - OIDC discovery (1h cache, 3 retries, 5s timeout, hardcoded fallback)

### Hooks (`src/hooks/`)

- `init/welcome.ts` - Node.js version check, ASCII banner on `--help`
- `init/update-notifier.ts` - Auto-update notification (24h check interval)
- `command_not_found/handle-invalid-commands.ts` - Invalid command handler
- `error/clean-errors.ts` - Error formatting
- `prerun/validate-brv-config-version.ts` - Config version validation

### TUI (`src/tui/`)

React/Ink terminal UI components:

- `components/` - Execution, inline prompts, onboarding dialogs
- `hooks/` - Activity logs, consumer, slash completion, tab navigation
- `contexts/` - React contexts for state management
- `types/` - Command, dialog, message, prompt type definitions

### Slash Commands (REPL)

Commands prefixed with `/` in the REPL (`src/infra/repl/commands/`):

- `/login`, `/logout` - Authentication
- `/init` - Project setup (team/space selection, context tree init)
- `/status` - Show auth, config, context tree state
- `/curate` - Add context to context tree
- `/push [--branch <name>]`, `/pull [--branch <name>]` - Cloud sync (default branch: `main`)
- `/space list`, `/space switch` - Space management
- `/gen-rules` - Generate agent-specific rule files
- `/clear` - Reset context tree (destructive)
- `/query` - Query context tree

**OAuth Flow**:

- `redirectUri`: `http://localhost:{port}/callback` (built after server starts)
- Login: `OAuthTokenData` → fetch User → `AuthToken` with `userId`/`userEmail`

## Testing

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

- `BRV_ENV` - `development` | `production` (dev-only oclif commands require `development`, set by bin/dev.js and bin/run.js)

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), React/Ink (TUI), axios, express, better-sqlite3, Mocha + Chai + Sinon + Nock
