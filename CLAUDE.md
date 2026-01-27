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

**Test dirs**: `test/commands/`, `test/unit/`, `test/integration/`, `test/hooks/`, `test/learning/`, `test/helpers/`, `test/shared/`
**Note**: Run tests from project root, not within test directories

## Development Standards

**Code Quality**:
- Follow clean code principles strictly
- Apply proper OOP design and design patterns where appropriate
- Apply functional programming principles where appropriate
- Avoid over-engineering; keep solutions simple and focused

**TypeScript**:
- Avoid `as Type` assertions - use type guards or proper typing instead
- Avoid `any` type - use `unknown` with type narrowing or proper generics
- Functions with >3 parameters must use object parameters

**CLI & API**:
- Follow CLI building best practices (consistent flags, helpful error messages, proper exit codes)
- Follow API integration best practices (proper error handling, retries, timeouts)
- Consider security risks (input validation, secrets handling, injection prevention)

**Testing**:
- Apply TDD; 50% coverage minimum, critical paths must be covered
- Run `npm run test` after each approved edit
- Suppress console logging in tests to keep output clean

**Feature Development (Outside-In Approach)**:
- Start from the consumer (oclif command, REPL command, or TUI component) - understand what it needs to accomplish, what data it requires, and the simplest call signature
- Define the minimal interface - only what the consumer actually requires, nothing more
- Implement the service - fulfill the interface contract
- Extract entities only if needed - when shared structure emerges naturally across multiple consumers
- Avoid designing in isolation - always have a concrete consumer driving the requirements to prevent interface mismatches and over-engineering

## Architecture

### REPL + TUI Architecture

- `brv` (no args) starts interactive REPL (`src/infra/repl/repl-startup.tsx`)
- React/Ink-based TUI (`src/tui/`) with streaming, dialogs, prompts
- Slash commands (`/command`) in `src/infra/repl/commands/` (order in `index.ts` = UI suggestion order)
- Few oclif commands remain: `main` (default), `status`, `curate`, `query`, `watch` (dev-only), `hook-prompt-submit` (hidden), `mcp` (hidden, spawned by coding agents)

### Architecture v1.0.0 (Multi-Process)

- Main process spawns Transport and Agent worker processes
- All task communication via Socket.IO (no direct IPC)
- Single instance per folder via lock file (`.brv/instance.lock`)
- `src/infra/process/` - Worker threads, task queue, IPC handlers
- `src/infra/transport/` - Socket.IO client/server, port utils
- `src/infra/instance/` - Instance lock management (acquire/release)

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
- `IMcpConfigWriter` - MCP config file persistence (JSON/TOML formats)

**Transport** (multi-process communication):

- `ITransportClient` - Connect, disconnect, request/response, room events
- `ITransportServer` - Broadcast, message handling, room management

**Instance Management**:

- `IInstanceManager` - Acquire/release instance locks (one folder = one server)
- `IInstanceDiscovery` - Discover running instances by folder

**Executors** (distinct from UseCases - wrap operations with agent injection):

- `ICurateExecutor`, `IQueryExecutor` - Execute with injected agent for long-lived instances

**Pagination**: `{fetchAll: true}` auto-paginates (100/page) or `{limit, offset}` manual

### Domain Entities (`src/core/domain/entities/`)

All have `toJson()`/`fromJson()`, immutable readonly properties

- `AuthToken` - `accessToken`, `refreshToken`, `sessionKey`, `userId`, `userEmail`, `expiresAt`. `fromJson()` returns `undefined` for old tokens (forces re-login)
- `OAuthTokenData` - OAuth response, no user info. Used before user fetch in login
- `User`, `Team`, `Space` - `getDisplayName()` methods
- `Agent` - 18 supported agents with connector configs (Amp, Augment Code, Claude Code, Cline, Codex, Cursor, Gemini CLI, Github Copilot, Junie, Kilo Code, Kiro, Qoder, Qwen Code, Roo Code, Trae.ai, Warp, Windsurf, Zed)
- `BrvConfig` - `.brv/config.json` with version validation
- `GlobalConfig` - User-level config with device ID
- `Event` - Tracking event definitions
- `CogitSnapshot`, `CogitPushContext` - CoGit sync entities
- `Parser` - Centralized parser types (raw + clean layers)
- `Playbook` - Knowledge repository with bullets and sections
- `PresignedUrl` - Blob storage presigned URLs

### Infrastructure (`src/infra/`)

**REPL** (`src/infra/repl/`):

- `repl-startup.tsx` - Bootstrap REPL with providers
- `commands/` - Slash command implementations (`/login`, `/push`, `/pull`, etc.)

**Cipher** (`src/infra/cipher/`) - LLM agent system:

- `llm/` - Multi-provider support (ByteRover internal API, OpenRouter proxy), formatters (Claude/Gemini), tokenizers, context compression, streaming with thinking visualization
- `tools/implementations/` - 23 tool implementations:
  - File: `read-file` (supports PDF text extraction), `write-file`, `edit-file`, `list-directory`, `glob-files`, `grep-content`
  - Bash: `bash-exec`, `bash-output`, `kill-process`
  - Memory: `read-memory`, `write-memory`, `edit-memory`, `delete-memory`, `list-memories`
  - Knowledge: `create-knowledge-topic`, `search-knowledge`
  - Todos: `read-todos`, `write-todos`
  - Other: `curate`, `task`, `batch`, `search-history`, `spec-analyze`
- `tools/policy-engine.ts` - Tool execution policy (ALLOW/DENY)
- `session/` - Chat session management
- `memory/` - Memory persistence

**MCP** (`src/infra/mcp/`) - Model Context Protocol server:

- `mcp-server.ts` - MCP server exposing brv-query/brv-curate tools
- `tools/` - Tool implementations for MCP clients

**Auth/HTTP**:

- `OAuthService` - Manages `code_verifier` internally
- `CallbackServer` - Force-closes keep-alive connections

**Context Tree**:

- `FileContextTreeService` - File-based context tree operations
- `FileContextTreeSnapshotService` - Git-style snapshot and diff tracking

**CoGit**:

- `HttpCogitPushService` / `HttpCogitPullService` - Cloud sync
- `context-tree-to-push-context-mapper.ts` - Maps context tree to push format

**Connectors** (`src/infra/connectors/`):

- `ConnectorManager` - Factory and orchestration for connectors
- `hook/` - Hook-based integration (Claude Code via settings.local.json)
- `rules/` - Rules-based integration (other agents via rule files)
- `mcp/` - MCP-based integration (exposes brv-query/brv-curate tools to agents)

**Knowledge** (`src/core/domain/knowledge/`):

- `markdown-writer.ts` - Write knowledge to markdown files
- `directory-manager.ts` - Knowledge directory management
- `relation-parser.ts` - Parse knowledge relations

**Tracking**:

- `MixpanelTrackingService` - Analytics implementation

**UseCases** (`src/infra/usecase/`) - Business logic orchestration:

- 12 use cases matching REPL commands: `init`, `login`, `logout`, `status`, `curate`, `query`, `push`, `pull`, `reset`, `space-list`, `space-switch`, `connectors`

### Config

- `environment.ts` - Dev/Prod config. Exports: `getCurrentConfig()`, `isDevelopment()`, `ENV_CONFIG`
- `auth.config.ts` - OIDC discovery (1h cache, 3 retries, 5s timeout, hardcoded fallback)

### Hooks (`src/oclif/hooks/`)

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
- `/connectors` - Manage agent connectors (hook for Claude Code, rules for others)
- `/reset` - Reset context tree (destructive)
- `/new [-y]` - Start fresh session (ends current, clears conversation history, NOT context tree)
- `/query` - Query context tree

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

<!-- BEGIN BYTEROVER RULES -->

# Workflow Instruction

You are a coding agent focused on one codebase. Use the brv CLI to manage working context.

## Core Rules

- **Start from memory.** First retrieve relevant context with `brv query`, then read only the code that's still necessary.
- **Keep a local context tree.** The context tree is your local memory store—update it with `brv curate` when you learn something valuable.

## When to Query

Use `brv query` **before** starting any code task that requires understanding the codebase:
- Writing, editing, or modifying code
- Understanding how something works
- Debugging or troubleshooting issues
- Making architectural decisions

## When to Curate

Use `brv curate` **after** you learn or create something valuable:
- Wrote or modified code
- Discovered how something works
- Made architectural/design decisions
- Found a bug root cause or fix pattern

## Context Tree Guideline

Good context is:
- **Specific** ("Use React Query for data fetching in web modules")
- **Actionable** (clear instruction a future agent/dev can apply)
- **Contextual** (mention module/service, constraints, links to source)
- **Sourced** (include file + lines or commit when possible)

---
# ByteRover CLI Command Reference

## Available Commands

- `brv curate` - Curate context to the context tree
- `brv query` - Query and retrieve information from the context tree
- `brv status` - Show CLI status and project information

Run `brv query --help` for query instruction and `brv curate --help` for curation instruction.

---
Generated by ByteRover CLI for Claude Code
<!-- END BYTEROVER RULES -->