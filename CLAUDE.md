# CLAUDE.md

ByteRover CLI (`brv`) - Interactive REPL with React/Ink TUI

## Dev Commands

```bash
npm run build                                    # Compile to dist/
npm test                                         # All tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
npm run lint                                     # ESLint
npm run typecheck                                # TypeScript type checking
./bin/dev.js [command]                          # Dev mode (ts-node)
./bin/run.js [command]                          # Prod mode
```

**Test dirs**: `test/commands/`, `test/unit/`, `test/integration/`, `test/hooks/`, `test/learning/`, `test/helpers/`, `test/shared/`
**Note**: Run tests from project root, not within test directories

## Development Standards

**TypeScript**:
- Avoid `as Type` assertions - use type guards or proper typing instead
- Avoid `any` type - use `unknown` with type narrowing or proper generics
- Functions with >3 parameters must use object parameters

**Testing (Strict TDD — MANDATORY)**:
- You MUST follow Test-Driven Development. This is non-negotiable.
  - **Step 1 — Write failing tests FIRST**: Before writing ANY implementation code, write or update tests that describe the expected behavior. Do NOT write implementation and tests together or in reverse order.
  - **Step 2 — Run tests to confirm they fail**: Execute the relevant test file to verify the new tests fail for the right reason (missing implementation, not a syntax error).
  - **Step 3 — Write the minimal implementation**: Write only enough code to make the failing tests pass. Do not add untested behavior.
  - **Step 4 — Run tests to confirm they pass**: Execute tests again to verify all tests pass.
  - **Step 5 — Refactor if needed**: Clean up while keeping tests green.
  - If you catch yourself writing implementation code without a failing test, STOP and write the test first.
- 50% coverage minimum, critical paths must be covered.
- Suppress console logging in tests to keep output clean.
- Unit tests must run fast and run completely in memory. Proper stubbing and mocking must be implemented.

**Feature Development (Outside-In Approach)**:
- Start from the consumer (oclif command, REPL command, or TUI component) - understand what it needs
- Define the minimal interface - only what the consumer actually requires
- Implement the service - fulfill the interface contract
- Extract entities only if needed - when shared structure emerges across multiple consumers
- Avoid designing in isolation - always have a concrete consumer driving requirements

## Architecture

### Source Structure

```
src/
├── agent/           # LLM agent system
│   ├── core/        # Agent interfaces and domain types
│   ├── infra/       # Tools, LLM services, sessions, storage, transport
│   └── resources/   # Prompt YAML configs, tool definition .txt files
├── server/          # Server-side infrastructure
│   ├── config/      # Auth config, environment
│   ├── core/        # Domain entities, interfaces, errors
│   ├── infra/       # Auth, connectors, daemon, hub, transport, etc.
│   ├── templates/   # Server templates
│   └── utils/       # Shared utilities (errors, file helpers, type guards)
├── shared/          # Cross-module shared code
│   ├── constants/   # Shared constants (curation limits, etc.)
│   ├── types/       # Shared types (Agent, ConnectorType)
│   ├── transport/   # Transport event definitions
│   └── utils/       # Shared utility functions
├── tui/             # React/Ink TUI
│   ├── app/         # Router, pages (home, login, config-provider), layouts
│   ├── components/  # Shared UI components
│   ├── features/    # Feature modules (commands, curate, query, hub, etc.)
│   ├── hooks/       # Shared React hooks
│   ├── lib/         # API client, environment, react-query setup
│   ├── providers/   # React context providers
│   ├── stores/      # Zustand stores
│   ├── types/       # Shared TUI type definitions
│   └── utils/       # TUI utility functions
└── oclif/           # Oclif commands, hooks, and lib/ (daemon-client, JSON response utils)
```

### REPL + TUI

- `brv` (no args) starts interactive REPL (`src/tui/repl-startup.tsx`)
- Pages in `src/tui/app/pages/` (home, login, config-provider)
- Esc key cancels streaming responses and long-running commands
- Slash commands in `src/tui/features/commands/definitions/` (order in `index.ts` = UI suggestion order)
- Oclif commands: public (`login`, `logout`, `status`, `locations`, `curate`, `curate view`, `query`, `push`, `pull`, `restart`, `connectors`, `providers`, `model`, `space`, `hub`) + hidden (`main`, `hook-prompt-submit`, `mcp`, `debug` [dev-only])
- `/exit` is REPL-only (no oclif command)

### Daemon Architecture

- Global daemon process (`src/server/infra/daemon/`) hosts Socket.IO transport server
- Clients (TUI, CLI, MCP, agent child processes) connect via `@campfirein/brv-transport-client`
- Agent pool manages forked agent child processes per project
- `src/server/infra/process/` - Task routing, transport handlers, feature handlers

### Agent (`src/agent/`)

- Tool definitions: `resources/tools/*.txt`; implementations: `infra/tools/implementations/`
- Tool registry pattern: `infra/tools/tool-registry.ts` — register/resolve tools by name
- Multi-provider LLM support (ByteRover internal, OpenRouter) in `infra/llm/`
- Compression strategies in `infra/llm/context/compression/` (reactive-overflow + escalated-compression)
- System prompt contributor pattern (XML-style sections) in `infra/system-prompt/`
- Map/memory subsystem (`infra/map/`): agentic map service, context-tree store, LLM map memory, worker pool
- Storage: file-based blob (`infra/blob/file-blob-storage.ts`) and key storage (`infra/storage/file-key-storage.ts`) — no SQLite

### Slash Commands

Commands in `src/tui/features/commands/definitions/` (order = UI suggestion order):

- `/status` - Show CLI status and project information
- `/locations` - List registered projects and context tree status
- `/curate` - Curate context to the context tree (supports `@file` and `@folder`)
- `/query` - Query the context tree
- `/connectors` - Manage agent connectors (rules, hook, mcp, skill)
- `/hub` - Browse and manage skills & bundles registry
- `/push [--branch <name>]`, `/pull [--branch <name>]` - Cloud sync (default: `main`)
- `/providers` - Connect to an LLM provider
- `/model` - Select a model from the active provider
- `/space list`, `/space switch` - Space management
- `/reset` - Reset context tree (destructive)
- `/new [-y]` - Start fresh session
- `/exit` - Gracefully exit the REPL
- `/login`, `/logout` - Authentication

### Oclif Hooks (`src/oclif/hooks/`)

- `init/welcome.ts` - Node.js version check, ASCII banner
- `init/update-notifier.ts` - Auto-update notification (1h check)
- `command_not_found/handle-invalid-commands.ts` - Invalid command handler
- `error/clean-errors.ts` - Error formatting
- `prerun/validate-brv-config-version.ts` - Config version validation

## Testing

- **HTTP (nock)**: Verify headers (`.matchHeader('authorization', ...)` + `.matchHeader('x-byterover-session-id', ...)`)
- **ES Modules**: Cannot stub ES exports with sinon; test utils with real filesystem (`tmpdir()`)

## Conventions

- ES modules: `"type": "module"`, **imports need `.js` extension**
- Interface names: `I` prefix
- Snake_case APIs: `/* eslint-disable camelcase */`
- Entity serialization: `toJson()` / `fromJson()` (capital J)

## Environment

- `BRV_ENV` - `development` | `production` (dev-only oclif commands require `development`, set by bin/dev.js and bin/run.js)

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), React/Ink (TUI), Zustand, axios, socket.io, Mocha + Chai + Sinon + Nock
