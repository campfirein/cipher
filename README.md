# ByteRover CLI

Command-line interface for ByteRover — an interactive REPL for managing your project's context tree and knowledge storage. Integrates with 22 AI coding agents including Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, and more.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)

## Installation

### macOS & Linux (Recommended)

No Node.js required — everything is bundled.

```bash
curl -fsSL https://byterover.dev/install.sh | sh
```

Supported platforms: macOS ARM64, Linux x64, Linux ARM64.

### All platforms (via npm)

Requires Node.js >= 20.

```bash
npm install -g byterover-cli
```

### Verify

```bash
brv --version
```

### Uninstall

If installed via `curl`:

```bash
curl -fsSL https://byterover.dev/uninstall.sh | sh
```

If installed via `npm`:

```bash
npm uninstall -g byterover-cli
```

## Quick Start

Visit [**ByteRover Docs**](https://docs.byterover.dev) for detailed guides.

### 1. Start the REPL

```bash
cd your/project
brv
```

The REPL auto-configures on first run — no setup commands needed.

### 2. Curate and query

Use `/curate` to add knowledge to your context tree and `/query` to retrieve it:

```
/curate "Auth uses JWT with 24h expiry" @src/middleware/auth.ts
/query How is authentication implemented?
```

### 3. (Optional) Authenticate for cloud sync

Authentication is only needed for syncing your context tree to the cloud via `/push` and `/pull`. Local usage works without login.

```bash
brv login -k <your-api-key>
```

Get your API key at [app.byterover.dev/settings/keys](https://app.byterover.dev/settings/keys).

### 4. (Optional) Connect an LLM provider

ByteRover works out of the box with its built-in provider. To use your own models, run `/providers` in the REPL to connect one of 20+ supported providers (Anthropic, OpenAI, Google, Groq, Mistral, and more).

## Supported AI Agents

ByteRover integrates with 22 AI coding agents including Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, Codex, Gemini CLI, Roo Code, Kiro, and more. Use `/connectors` in the REPL to manage integrations.

See [ByteRover Docs](https://docs.byterover.dev) for the full list and integration details.

## Key Commands

### REPL Commands

| Command | Description |
|---------|-------------|
| `/curate [context] @files @folders` | Add context to the context tree |
| `/query <question>` | Query the context tree (alias: `/q`) |
| `/push [-b branch]` | Push context tree to cloud |
| `/pull [-b branch]` | Pull context tree from cloud |
| `/connectors` | Manage AI agent connectors |
| `/hub` | Browse and install skills from the hub |
| `/provider` | Connect an LLM provider |
| `/model` | Select an LLM model |
| `/status` | Show project and CLI status |
| `/space` | Manage spaces |
| `/new` | Start a fresh session |
| `/login` / `/logout` | Authenticate or log out |

Type `/` in the REPL to see all commands with auto-completion.

### CLI Commands

| Command | Description |
|---------|-------------|
| `brv` | Start the interactive REPL |
| `brv login -k <key>` | Authenticate with an API key |
| `brv status` | Show CLI and project status |
| `brv query <question>` | Query the context tree |
| `brv curate [context]` | Curate context to the context tree |
| `brv push` | Push context tree to cloud |
| `brv pull` | Pull context tree from cloud |

All commands support `--format json` flags for automation. Run `brv <command> --help` for details.

## Documentation & Help

- [ByteRover Docs](https://docs.byterover.dev) — Full documentation
- `brv --help` — CLI help
- Type `/` in the REPL — Command discovery

---

**Copyright (c) ByteRover**
