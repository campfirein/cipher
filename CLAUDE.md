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

### Source Structure

```
src/
├── agent/           # LLM agent system
│   ├── core/        # Agent interfaces and domain types
│   └── infra/       # Tools, LLM services, sessions, storage
├── server/          # Server-side infrastructure
│   ├── core/        # Domain entities and interfaces
│   └── infra/       # Auth, connectors, transport, usecases
├── tui/             # React/Ink TUI + slash commands
│   ├── commands/    # Slash command implementations
│   └── components/  # UI components, dialogs, prompts
└── oclif/           # Oclif commands and hooks
```

### REPL + TUI

- `brv` (no args) starts interactive REPL (`src/tui/repl-startup.tsx`)
- React/Ink-based TUI with streaming, dialogs, prompts
- Views in `src/tui/views/` (main, init, login)
- Esc key cancels streaming responses and long-running commands
- Slash commands in `src/tui/commands/` (order in `index.ts` = UI suggestion order)
- Oclif commands: 7 public (`init`, `login`, `status`, `curate`, `query`, `push`, `pull`) + 3 hidden (`main`, `hook-prompt-submit`, `mcp`). Note: `/logout` is REPL-only

### Multi-Process Architecture

- Main process spawns Transport and Agent worker processes
- All task communication via Socket.IO (no direct IPC)
- Single instance per folder via lock file (`.brv/instance.lock`)
- `src/server/infra/process/` - Worker threads, task queue, IPC handlers
- `src/server/infra/transport/` - Socket.IO client/server, port utils
- `src/server/infra/instance/` - Instance lock management

### Headless Execution

- `--headless` flag on: `init`, `status`, `curate`, `query`, `push`, `pull`
- `InlineAgentExecutor` - Ephemeral in-process agent, bypasses REPL/Transport
- `HeadlessTerminal` - Non-interactive output (text/JSON formats)
- `HeadlessPromptError` - Thrown when prompts cannot be answered headlessly

### Task Queue

- `TaskQueueManager` - FIFO queue, sequential execution (max concurrency = 1)
- Deduplication, cancellation, lifecycle: enqueue → activate → process → complete

### Server Core (`src/server/core/`)

**Interfaces** (`interfaces/`):

- `IProviderConfigStore` - Provider config (connect, disconnect, active model/provider)
- `IProviderKeychainStore` - Secure API key storage via system keychain

**Domain Entities** (`domain/entities/`):

- `AuthToken`, `OAuthTokenData` - Auth tokens with session keys
- `User`, `Team`, `Space` - `getDisplayName()` methods
- `Agent` - 19 supported agents with connector configs (Amp, Antigravity, Augment Code, Claude Code, Cline, Codex, Cursor, Gemini CLI, Github Copilot, Junie, Kilo Code, Kiro, Qoder, Qwen Code, Roo Code, Trae.ai, Warp, Windsurf, Zed)
- `ConnectorType` - `'rules' | 'hook' | 'mcp' | 'skill'`
- `BrvConfig`, `GlobalConfig` - Config persistence
- `ProviderConfig`, `ProviderDefinition` - LLM provider registry

### Server Infra (`src/server/infra/`)

- `auth/` - OAuth + PKCE, callback server
- `cogit/` - Cloud sync (push/pull)
- `connectors/` - 4 connector types (skill, hook, mcp, rules)
- `context-tree/` - File-based context tree operations
- `executor/` - Curate/Query executors
- `http/` - HTTP client, OpenRouter API
- `mcp/` - MCP server exposing brv-query/brv-curate tools
- `memory/` - HTTP memory retrieval/storage services
- `storage/` - Provider config, keychain, global config
- `terminal/` - HeadlessTerminal implementation
- `tracking/` - Mixpanel analytics
- `transport/` - Socket.IO client/server (`@campfirein/brv-transport-client` bundled dependency)
- `workspace/` - Workspace detector service
- `usecase/` - 12 use cases: `init`, `login`, `logout`, `status`, `curate`, `query`, `push`, `pull`, `reset`, `space-list`, `space-switch`, `connectors`
- HTTP service wrappers: `space/`, `team/`, `user/`
- Utilities: `browser/`, `file/`, `template/`

### Agent (`src/agent/`)

**LLM** (`infra/llm/`):

- Multi-provider support (ByteRover internal, OpenRouter)
- Formatters (Claude/Gemini), tokenizers, context compression
- Streaming with reasoning/thinking visualization
- Model capability detection (`native-field`, `think-tags`, `interleaved`, `none`)

**Tools** (`infra/tools/implementations/`) - 23 tools:

- File: `read-file` (PDF support), `write-file`, `edit-file`, `list-directory`, `glob-files`, `grep-content`
- Bash: `bash-exec`, `bash-output`, `kill-process`
- Sandbox: `code-exec` - Sandboxed JS/TS execution with ToolsSDK (glob, grep, readFile, curate, searchKnowledge)
- Memory: `read-memory`, `write-memory`, `edit-memory`, `delete-memory`, `list-memories`
- Knowledge: `create-knowledge-topic`, `search-knowledge`
- Todos: `read-todos`, `write-todos`
- Other: `curate`, `batch`, `search-history`, `spec-analyze`

**Infra Services** (`infra/`):

- `agent/` - Agent lifecycle management
- `blob/` - Blob handling
- `display/` - Display/rendering utilities
- `document-parser/` - PDF and Office file (docx, xlsx, pptx) parsing
- `environment/` - EnvironmentContext builder
- `events/` - Event handling
- `file-system/` - File system utilities
- `folder-pack/` - Pack directories into XML format (`@folder` reference in curate)
- `http/` - HTTP client for agent requests
- `logger/` - Logging infrastructure
- `memory/` - Memory persistence
- `process/` - Agent process management
- `sandbox/` - Sandboxed code execution (local sandbox, ToolsSDK with pre-loaded packages)
- `session/` - Chat session management
- `storage/` - History, message storage
- `system-prompt/` - System prompt manager with contributor pattern (XML-style sections)
- `todos/` - Todo persistence
- `validation/` - Input validation

### TUI (`src/tui/`)

- `commands/` - Slash command implementations
- `components/` - Execution, prompts, dialogs, reasoning display
- `hooks/` - Activity logs, slash completion, tab navigation
- `contexts/` - React contexts for state management

### Slash Commands

Commands in `src/tui/commands/` (order = UI suggestion order):

- `/status` - Show auth, config, context tree state
- `/curate` - Add context to context tree (supports `@file` and `@folder` references)
- `/query` (alias: `/q`) - Query context tree
- `/connectors` - Manage agent connectors
- `/push [--branch <name>]`, `/pull [--branch <name>]` - Cloud sync (default: `main`)
- `/provider` (aliases: `/providers`, `/connect`), `/model` (alias: `/models`) - LLM provider/model selection
- `/space list`, `/space switch` - Space management
- `/reset` - Reset context tree (destructive)
- `/new [-y]` - Start fresh session
- `/init` - Project setup
- `/login`, `/logout` - Authentication

### Oclif Hooks (`src/oclif/hooks/`)

- `init/welcome.ts` - Node.js version check, ASCII banner
- `init/update-notifier.ts` - Auto-update notification (1h check)
- `command_not_found/handle-invalid-commands.ts` - Invalid command handler
- `error/clean-errors.ts` - Error formatting
- `prerun/validate-brv-config-version.ts` - Config version validation

### Config

- `src/server/config/environment.ts` - Dev/Prod config
- `src/server/config/auth.config.ts` - OIDC discovery

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