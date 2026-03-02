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

**TypeScript**:
- Avoid `as Type` assertions - use type guards or proper typing instead
- Avoid `any` type - use `unknown` with type narrowing or proper generics
- Functions with >3 parameters must use object parameters

**Testing**:
- Apply TDD; 50% coverage minimum, critical paths must be covered
- Run `npm run test` after each approved edit
- Suppress console logging in tests to keep output clean
- Unit tests must run fast and  run completely in memory. Proper stubbing and mocking must be implemented.

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
│   ├── core/        # Domain entities, interfaces, errors
│   ├── infra/       # Auth, connectors, daemon, hub, transport, etc.
│   └── utils/       # Shared utilities (errors, file helpers, type guards)
├── shared/          # Cross-module shared code
│   ├── types/       # Shared types (Agent, ConnectorType)
│   └── transport/   # Transport event definitions
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
└── oclif/           # Oclif commands and hooks
```

### REPL + TUI

- `brv` (no args) starts interactive REPL (`src/tui/repl-startup.tsx`)
- Pages in `src/tui/app/pages/` (home, login, config-provider)
- Esc key cancels streaming responses and long-running commands
- Slash commands in `src/tui/features/commands/definitions/` (order in `index.ts` = UI suggestion order)
- Oclif commands: public (`login`, `status`, `curate`, `curate view`, `query`, `push`, `pull`, `restart`, `connectors`, `providers`, `model`, `space`, `hub`) + hidden (`main`, `hook-prompt-submit`, `mcp`, `debug` [dev-only])
- `/logout` is REPL-only (no oclif command)

### Daemon Architecture

- Global daemon process (`src/server/infra/daemon/`) hosts Socket.IO transport server
- Clients (TUI, CLI, MCP, agent child processes) connect via `@campfirein/brv-transport-client`
- Agent pool manages forked agent child processes per project
- `src/server/infra/process/` - Task routing, transport handlers, feature handlers

### Agent (`src/agent/`)

- Tool definitions: `resources/tools/*.txt`; implementations: `infra/tools/implementations/`
- Multi-provider LLM support (ByteRover internal, OpenRouter) in `infra/llm/`
- System prompt contributor pattern (XML-style sections) in `infra/system-prompt/`

### Slash Commands

Commands in `src/tui/features/commands/definitions/` (order = UI suggestion order):

- `/status` - Show CLI status and project information
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
