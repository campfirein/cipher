# CLAUDE.md

ByteRover CLI (`brv`) - Interactive REPL with React/Ink TUI

## Commands

```bash
npm run build                        # Compile to dist/
npm run dev                          # Kill daemon + build + run dev mode
npm test                             # All tests
npx mocha --forbid-only "test/path/to/file.test.ts"  # Single test
npm run lint                         # ESLint
npm run typecheck                    # TypeScript type checking
./bin/dev.js [command]               # Dev mode (ts-node)
./bin/run.js [command]               # Prod mode
```

**Test dirs**: `test/commands/`, `test/unit/`, `test/integration/`, `test/hooks/`, `test/learning/`, `test/helpers/`, `test/shared/`
**Note**: Run tests from project root, not within test directories

## Development Standards

**TypeScript**:
- Avoid `as Type` assertions - use type guards or proper typing instead
- Avoid `any` type - use `unknown` with type narrowing or proper generics
- Functions with >3 parameters must use object parameters
- Prefer `type` for data-only shapes (DTOs, payloads, configs); prefer `interface` for behavioral contracts with method signatures (services, repositories, strategies)

**Testing (Strict TDD — MANDATORY)**:
- You MUST follow Test-Driven Development. This is non-negotiable.
  - **Step 1 — Write failing tests FIRST**: Before writing ANY implementation code, write or update tests that describe the expected behavior. Do NOT write implementation and tests together or in reverse order.
  - **Step 2 — Run tests to confirm they fail**: Execute the relevant test file to verify the new tests fail for the right reason (missing implementation, not a syntax error).
  - **Step 3 — Write the minimal implementation**: Write only enough code to make the failing tests pass. Do not add untested behavior.
  - **Step 4 — Run tests to confirm they pass**: Execute tests again to verify all tests pass.
  - **Step 5 — Refactor if needed**: Clean up while keeping tests green.
  - If you catch yourself writing implementation code without a failing test, STOP and write the test first.
- 80% coverage minimum, critical paths must be covered.
- Suppress console logging in tests to keep output clean.
- Unit tests must run fast and run completely in memory. Proper stubbing and mocking must be implemented.

**Feature Development (Outside-In Approach — applies to ALL work: planning, reviewing, coding, and auditing)**:
- This is a foundational principle, not just a coding guideline. Apply it when writing code, reviewing plans, designing milestones, evaluating project structure, or auditing existing work. If a plan, project, or milestone ordering violates Outside-In, flag it.
- Start from the consumer (oclif command, REPL command, or TUI component) — understand what it needs
- Define the minimal interface — only what the consumer actually requires
- Implement the service — fulfill the interface contract
- Extract entities only if needed — when shared structure emerges across multiple consumers
- Avoid designing in isolation — always have a concrete consumer driving requirements
- When reviewing or planning: if entities, types, or store interfaces are designed before any consumer exists to validate them, that is Inside-Out and must be flagged

## Architecture

### Source Layout (`src/`)

- `agent/` — LLM agent: `core/` (interfaces/domain), `infra/` (22 modules, including memory, document-parser), `resources/` (prompts YAML, tools `.txt`)
- `server/` — Daemon infrastructure: `config/`, `core/` (domain/interfaces), `infra/` (29 modules, including vc, hub, mcp, cogit), `utils/`
- `shared/` — Cross-module: constants, types, transport events, utils
- `tui/` — React/Ink TUI: app (router/pages), components, features (21 modules, including vc, hub, curate), hooks, lib, providers, stores
- `oclif/` — Commands (`vc/`, `review/`, top-level), hooks, lib (daemon-client, JSON response utils)

**Import boundary** (ESLint-enforced): `tui/` must not import from `server/`, `agent/`, or `oclif/`. Use transport events or `shared/`.

### REPL + TUI

- `brv` (no args) starts REPL (`src/tui/repl-startup.tsx`)
- Esc cancels streaming responses and long-running commands
- Slash commands in `src/tui/features/commands/definitions/` (order in `index.ts` = suggestion order)

### Daemon

- Global daemon (`server/infra/daemon/`) hosts Socket.IO transport; clients connect via `@campfirein/brv-transport-client`
- Agent pool manages forked child processes per project; task routing in `server/infra/process/`
- MCP server in `server/infra/mcp/` exposes tools via Model Context Protocol

### VC (Version Control)

- `brv vc` — isomorphic-git-based version control (add, branch, checkout, clone, commit, config, fetch, init, log, merge, pull, push, remote, reset, status)
- Oclif commands: `src/oclif/commands/vc/`, TUI feature: `src/tui/features/vc/`, server infra: `src/server/infra/vc/`
- Slash commands: `vc-*` definitions in `src/tui/features/commands/definitions/`

### Agent (`src/agent/`)

- Tools: definitions in `resources/tools/*.txt`, implementations in `infra/tools/implementations/`, registry in `infra/tools/tool-registry.ts`
- Tool categories: file ops (read/write/glob/grep), knowledge (create/expand/search), memory (read/write/edit/delete/list), curate, code exec, map
- LLM: 18 providers in `infra/llm/providers/`; 6 compression strategies in `infra/llm/context/compression/`
- System prompts: contributor pattern (XML sections) in `infra/system-prompt/`
- Map/memory: `infra/map/` (agentic map, context-tree store, LLM map memory, worker pool); `infra/memory/` (memory-manager, deduplicator)
- Storage: file-based blob (`infra/blob/`) and key storage (`infra/storage/`) — no SQLite

## Testing Gotchas

- **HTTP (nock)**: Must verify `.matchHeader('authorization', ...)` + `.matchHeader('x-byterover-session-id', ...)`
- **ES Modules**: Cannot stub ES exports with sinon; test utils with real filesystem (`tmpdir()`)

## Conventions

- ES modules with `.js` import extensions required
- `I` prefix for interfaces; `toJson()`/`fromJson()` (capital J) for serialization
- Snake_case APIs: `/* eslint-disable camelcase */`

## Environment

- `BRV_ENV` — `development` | `production` (dev-only commands require `development`, set by `bin/dev.js` and `bin/run.js`)

## Stack

oclif v4, TypeScript (ES2022, Node16 modules, strict), React/Ink (TUI), Zustand, axios, socket.io, isomorphic-git, Mocha + Chai + Sinon + Nock
