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

## Architecture

### REPL + TUI Architecture

- `brv` (no args) starts interactive REPL (`src/infra/repl/repl-startup.tsx`)
- React/Ink-based TUI (`src/tui/`) with streaming, dialogs, prompts
- Slash commands (`/command`) in `src/infra/repl/commands/`
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

- `llm/` - Multi-provider support (ByteRover internal, OpenRouter), tokenizers, context compression, streaming with thinking visualization
- `tools/implementations/` - 23 tool implementations:
  - File: `read-file`, `write-file`, `edit-file`, `list-directory`, `glob-files`, `grep-content`
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
Core Rules:

- Start from memory. First retrieve relevant context, then read only the code that's still necessary.
- Keep a local context tree. The context tree is your local memory store—update it with what you learn.

## Context Tree Guideline

- Be specific ("Use React Query for data fetching in web modules").
- Be actionable (clear instruction a future agent/dev can apply).
- Be contextual (mention module/service, constraints, links to source).
- Include source (file + lines or commit) when possible.

## Using `brv curate` with Files

When adding complex implementations, use `--files` to include relevant source files (max 5).  Only text/code files from the current project directory are allowed. **CONTEXT argument must come BEFORE --files flag.** For multiple files, repeat the `--files` (or `-f`) flag for each file.

Examples:

- Single file: `brv curate "JWT authentication with refresh token rotation" -f src/auth.ts`
- Multiple files: `brv curate "Authentication system" --files src/auth/jwt.ts --files src/auth/middleware.ts --files docs/auth.md`

## CLI Usage Notes

- Use --help on any command to discover flags. Provide exact arguments for the scenario.

---
# ByteRover CLI Command Reference

## Memory Commands

### `brv curate`

**Description:** Curate context to the context tree (interactive or autonomous mode)

**Arguments:**

- `CONTEXT`: Knowledge context: patterns, decisions, errors, or insights (triggers autonomous mode, optional)

**Flags:**

- `--files`, `-f`: Include file paths for critical context (max 5 files). Only text/code files from the current project directory are allowed. **CONTEXT argument must come BEFORE this flag.**

**Good examples of context:**

- "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
- "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"

**Bad examples:**

- "Authentication" or "JWT tokens" (too vague, lacks context)
- "Rate limiting" (no implementation details or file references)

**Examples:**

```bash
# Interactive mode (manually choose domain/topic)
brv curate

# Autonomous mode - LLM auto-categorizes your context
brv curate "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"

# Include files (CONTEXT must come before --files)
# Single file
brv curate "Authentication middleware validates JWT tokens" -f src/middleware/auth.ts

# Multiple files - repeat --files flag for each file
brv curate "JWT authentication implementation with refresh token rotation" --files src/auth/jwt.ts --files docs/auth.md
```

**Behavior:**

- Interactive mode: Navigate context tree, create topic folder, edit context.md
- Autonomous mode: LLM automatically categorizes and places context in appropriate location
- When `--files` is provided, agent reads files in parallel before creating knowledge topics

**Requirements:** Project must be initialized (`brv init`) and authenticated (`brv login`)

---

### `brv query`

**Description:** Query and retrieve information from the context tree

**Arguments:**

- `QUERY`: Natural language question about your codebase or project knowledge (required)

**Good examples of queries:**

- "How is user authentication implemented?"
- "What are the API rate limits and where are they enforced?"

**Bad examples:**

- "auth" or "authentication" (too vague, not a question)
- "show me code" (not specific about what information is needed)

**Examples:**

```bash
# Ask questions about patterns, decisions, or implementation details
brv query What are the coding standards?
brv query How is authentication implemented?
```

**Behavior:**

- Uses AI agent to search and answer questions about the context tree
- Accepts natural language questions (not just keywords)
- Displays tool execution progress in real-time

**Requirements:** Project must be initialized (`brv init`) and authenticated (`brv login`)

---

## Best Practices

### Efficient Workflow

1. **Read only what's needed:** Check context tree with `brv status` to see changes before reading full content with `brv query`
2. **Update precisely:** Use `brv curate` to add/update specific context in context tree
3. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Context tree Management

- Use `brv curate` to directly add/update context in the context tree

---
Generated by ByteRover CLI for Claude Code
<!-- END BYTEROVER RULES -->