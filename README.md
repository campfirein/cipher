# ByteRover CLI

Command-line interface for ByteRover, featuring an interactive REPL with a modern React/Ink terminal UI for managing your project's context tree and knowledge storage. Seamlessly integrate with 19 AI coding agents via modern skill files, MCP tools, or rules-based integration—supports Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, and more.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

## Table of Contents

* [Installation](#installation)
* [Quick Start](#quick-start)
* [Interactive REPL](#interactive-repl)
* [Keyboard Shortcuts](#keyboard-shortcuts)
* [CLI Commands](#cli-commands)
* [Headless Mode](#headless-mode)
* [What is Context Tree?](#what-is-context-tree)
* [Supported AI Agents](#supported-ai-agents)
* [LLM Providers](#llm-providers) (BETA)
* [Slash Commands Reference](#slash-commands-reference)
* [Authentication](#authentication)
* [Configuration](#configuration)
* [Troubleshooting](#troubleshooting)
* [Getting Help](#getting-help)

## Installation

### Requirements

- **Node.js**: >= 20.0.0
- **Operating System**:
  - macOS
  - Windows
  - Linux
    - Currently this CLI uses `libsecret`. Depending on your distribution, you will need to run the following command:
      - Debian/Ubuntu: `sudo apt-get install libsecret-1-dev`
      - Red Hat-based: `sudo yum install libsecret-devel`
      - Arch Linux: `sudo pacman -S libsecret`
- **WSL (Windows Subsystem for Linux)**: Supported with automatic file-based token storage fallback when keychain is unavailable

### Install globally via npm

```bash
npm install -g byterover-cli
```

### Verify installation

```bash
brv --version
```

## Quick Start

Visit [**ByteRover Docs**](https://docs.byterover.dev) for more information.

Get started with ByteRover CLI:

### 1. Start the REPL

```bash
cd to/your/project
brv
```

This launches the interactive REPL with a modern terminal UI.

### 2. Authenticate

In the REPL, type:

```
/login
```

This opens your browser to complete OAuth authentication. Your credentials are securely stored in the system keychain.

### 3. Initialize your project

```
/init
```

Select a team and space from your available options, and ByteRover will set up your project's context tree.

### 4. (Optional) Configure Agent Connectors

```
/connectors
```

ByteRover automatically configures the best connector for your installed agents:
- **Skill files** for Claude Code and Cursor (modern, discoverable)
- **MCP tools** for most other agents (universal protocol)
- Switch connector types anytime via `/connectors`

### 5. (Optional) Connect an LLM Provider

```
/provider
```

ByteRover works out of the box with its built-in LLM provider. To use your own models, connect to [OpenRouter](https://openrouter.ai/keys) for access to 200+ models. See [LLM Providers](#llm-providers) for details.

You're now ready to use ByteRover! Try `/status` to see your project's current state.

## Interactive REPL

ByteRover CLI features an interactive REPL (Read-Eval-Print Loop) with a React/Ink-based terminal UI.

### Starting the REPL

```bash
brv
```

Running `brv` without arguments starts the interactive REPL. The REPL requires an interactive terminal (TTY).

### TUI Features

The terminal UI includes:

- **Tab Navigation**: Switch between Chat and Activity views using `Tab`
- **Command Completion**: Type `/` to see available commands with auto-completion
- **Activity Log**: Real-time task status and execution progress
- **Streaming Output**: Live responses with markdown rendering (headings, lists, blockquotes, code blocks)
- **Reasoning Display**: View agent thinking process with streamed reasoning blocks
- **File & Folder References**: Type `@` in curate mode to browse and attach files or entire folders
- **PDF & Office Support**: Reference and extract text from PDF, Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files using `@` (PDF: 100 pages default, 200 max)
- **Structured Content Preservation**: Curated context retains diagrams (Mermaid, PlantUML, ASCII art), tables, procedures, and code examples in full fidelity
- **Dynamic Domains**: Automatically creates new knowledge domains as your context tree grows
- **Session Persistence**: Sessions auto-resume after restart
- **Expandable Views**: Press `Ctrl+O` to expand messages or logs to full-screen with vim-style navigation
- **Version Indicator**: Shows "(latest)" when running the most current version

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Switch between Chat and Activity views |
| `Ctrl+O` | Expand message or log to full-screen |
| `j` / `k` | Scroll down/up in expanded view |
| `g` / `G` | Jump to top/bottom in expanded view |
| `Esc` | Cancel streaming responses and long-running commands / exit expanded view |
| `q` | Exit expanded view |
| `/` | Show command suggestions |
| `@` | Browse files and folders (in curate mode) |

## CLI Commands

In addition to the interactive REPL, ByteRover CLI provides direct command-line commands for automation and scripting.

### Authentication

| Command | Description |
|---------|-------------|
| `brv login -k <key>` | Authenticate with an API key |

**Example:**
```bash
brv login --api-key your-api-key
```

Get your API key at [app.byterover.dev/settings/keys](https://app.byterover.dev/settings/keys).

### Project Commands

| Command | Description |
|---------|-------------|
| `brv init` | Initialize a project with ByteRover |
| `brv status [dir]` | Show CLI status and project information |

**Init flags:**
- `-f, --force`: Force re-initialization without confirmation
- `--headless`: Run in headless mode (requires `--team` and `--space`)
- `--team <id|name>`: Team ID or name
- `--space <id|name>`: Space ID or name
- `--format <text|json>`: Output format (default: text)

**Status flags:**
- `-f, --format <text|json>`: Output format (default: text)
- `--headless`: Run in headless mode

### Context Operations

| Command | Description |
|---------|-------------|
| `brv query <question>` | Query the context tree |
| `brv curate [context]` | Curate context to the context tree |

**Note:** `query` and `curate` require a running `brv` instance in another terminal.

**Query flags:**
- `--headless`: Run in headless mode
- `--format <text|json>`: Output format (default: text)

**Curate flags:**
- `-f, --files <path>`: Include specific files (max 5, can be repeated)
- `-d, --folder <path>`: Folder path to pack and analyze (can be repeated)
- `--headless`: Run in headless mode
- `--format <text|json>`: Output format (default: text)

**Curate examples:**
```bash
brv curate "Auth uses JWT with 24h expiry" -f src/middleware/auth.ts
brv curate --folder src/auth/
brv curate "Analyze auth module" -d src/auth/
```

### Cloud Sync

| Command | Description |
|---------|-------------|
| `brv push` | Push context tree to ByteRover cloud |
| `brv pull` | Pull context tree from ByteRover cloud |

**Push flags:**
- `-b, --branch <name>`: ByteRover branch name (default: main, not Git branch)
- `-y, --yes`: Skip confirmation prompt
- `--headless`: Run in headless mode (auto-skips confirmation)
- `--format <text|json>`: Output format (default: text)

**Pull flags:**
- `-b, --branch <name>`: ByteRover branch name (default: main, not Git branch)
- `--headless`: Run in headless mode
- `--format <text|json>`: Output format (default: text)

## Headless Mode

ByteRover CLI supports headless mode for automation, CI/CD pipelines, and scripting. Headless mode disables interactive prompts and supports machine-readable JSON output.

### Supported Commands

The following commands support `--headless` mode:
- `brv init` (requires `--team` and `--space`)
- `brv status`
- `brv query`
- `brv curate`
- `brv push` (auto-skips confirmation)
- `brv pull`

### Output Formats

Use `--format` to control output:
- `text` (default): Human-readable text output
- `json`: NDJSON (newline-delimited JSON) for machine parsing

### CI/CD Examples

**Initialize a project in CI:**
```bash
brv login --api-key $BRV_API_KEY
brv init --headless --team "my-team" --space "my-space" --format json
```

**Push context tree after tests pass:**
```bash
brv push --headless --format json -y
```

**Query context in a script:**
```bash
brv query "What are the API endpoints?" --headless --format json
```

### JSON Output Structure

JSON output uses NDJSON format with message types:
- `log`: Progress messages
- `output`: Main output content
- `error`: Error messages
- `warning`: Warning messages
- `result`: Final operation result

## What is Context Tree?

The **Context Tree** is ByteRover's structured knowledge system that helps you and your AI coding agents organize, store, and retrieve project context efficiently.

### Why Use Context Tree?

- **Organized Knowledge**: Structure your project knowledge by domain and topic
- **Easy Retrieval**: Find relevant context quickly when you need it
- **Persistent Memory**: Maintain project-specific knowledge across sessions
- **Agent-Friendly**: Works seamlessly with 19 AI coding agents (Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, and more) via skill files, MCP tools, hooks, or rules
- **Cloud Sync**: Push and sync your context tree to ByteRover's cloud storage for backup and team collaboration
- **Dynamic Domains**: Automatically creates new domains as your knowledge grows

### How It Works

The context tree organizes knowledge into:
- **Domains**: High-level categories (e.g., Architecture, API, Frontend) — created automatically or manually
- **Topics**: Specific subjects within domains (e.g., Authentication, Components)
- **Context Files**: Markdown files containing your actual knowledge

### Query Intelligence

- **Tiered responses**: Queries are answered via a 4-tier system—cached results return instantly, high-confidence matches skip the LLM entirely, and complex queries use an optimized agentic loop
- **Out-of-domain detection**: When a topic isn't covered in your context tree, ByteRover tells you clearly instead of guessing, and suggests using `/curate` to add the missing knowledge

## Supported AI Agents

ByteRover integrates with 19 AI coding agents:

**Skill Connector (Default):**
- Claude Code, Cursor

**MCP Connector (Default):**
- Amp, Codex, Gemini CLI, Github Copilot, Junie, Kilo Code, Kiro, Roo Code, Zed

**Rules Connector (Default):**
- Antigravity, Augment Code, Cline, Qoder, Qwen Code, Trae.ai, Warp, Windsurf

**All agents support rules-based integration as a universal fallback option.**

Use `/connectors` in the REPL to view, install, or switch connector types for your agents.

### Integrating with Coding Agents

Use `/connectors` to manage integrations with your AI coding agents:

```
/connectors
```

ByteRover supports four connector types:

1. **Skill integration** (Claude Code, Codex, Cursor, Github Copilot): Modern integration that writes a markdown skill file (SKILL.md) to your agent's skills directory for easy discovery and guidance
2. **MCP integration** (11 agents): Exposes brv-query and brv-curate as Model Context Protocol tools that AI agents can call directly
3. **Rules-based** (all agents): Generates agent-specific rule files (e.g., CLAUDE.md, .cursorrules) with instructions for using ByteRover
4. **Hook integration** (Claude Code only - legacy): Direct injection via IDE settings, replaced by skill connector

**Defaults by agent:**
- Claude Code, Cursor: Skill connector
- Amp, Codex, Gemini CLI, Github Copilot, Junie, Kilo Code, Kiro, Roo Code, Zed: MCP connector
- Antigravity, Augment Code, Cline, Qoder, Qwen Code, Trae.ai, Warp, Windsurf: Rules connector
- Rules: Available for all agents as fallback

## LLM Providers (BETA)

ByteRover uses LLMs internally to power `/curate` and `/query` operations. By default, the built-in ByteRover provider is used with no configuration required. You can optionally connect to OpenRouter to access 200+ models.

### Available Providers

| Provider | API Key Required | Models |
|----------|-----------------|--------|
| **ByteRover** (default) | No | Built-in internal model |
| **OpenRouter** | Yes | 200+ models from Anthropic, OpenAI, Google, Meta, and more |

### Connecting a Provider

Use `/provider` (aliases: `/providers`, `/connect`) to switch providers:

```
/provider
```

This opens an interactive prompt showing all available providers with their connection status.

### Selecting a Model

When connected to OpenRouter, use `/model` (alias: `/models`) to browse and select models:

```
/model
```

The model browser shows:
- **Pricing**: Input/output cost per million tokens (e.g., `$3.00/$15.00/M`)
- **Context window**: Maximum token capacity (e.g., `200K ctx`)
- **Free models**: Marked with `[Free]`
- **Favorites and recents**: Starred and recently used models appear first

### OpenRouter Setup

1. Get an API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Run `/provider` and select **OpenRouter**
3. Paste your API key when prompted (stored securely in system keychain)
4. Run `/model` to select a model (default: `anthropic/claude-3.5-sonnet`)

## Slash Commands Reference

### Core Workflow

| Command | Description |
|---------|-------------|
| `/status` | Show CLI status and project information |
| `/curate [context] @files @folders` | Curate context to the context tree |
| `/query <question>` | Query and retrieve information from the context tree |

**Curate examples:**
```
/curate                                    # Interactive mode
/curate "Auth uses JWT tokens"             # Autonomous mode with text
/curate "API docs" @src/api.ts @README.md  # With file references (max 5, supports PDF)
/curate "Project structure" @src/          # With folder reference
```

**Query example:**
```
/query How is authentication implemented?
/q What endpoints exist?                   # /q is an alias for /query
```

### Sync Operations

| Command | Description |
|---------|-------------|
| `/push [-b branch] [-y]` | Push context tree to ByteRover cloud storage |
| `/pull [-b branch]` | Pull context tree from ByteRover cloud storage |

**Options:**
- `-b, --branch <name>`: ByteRover branch name (default: `main`)
- `-y, --yes`: Skip confirmation prompt

**Examples:**
```
/push                    # Push to main branch
/push -b feature-auth    # Push to a specific branch
/push -y                 # Push without confirmation
/pull -b feature-auth    # Pull from a specific branch
```

### Space Management

| Command | Description |
|---------|-------------|
| `/space list` | List all spaces for the current team |
| `/space switch` | Switch to a different space |

**Space list options:**
- `-a, --all`: Fetch all spaces
- `-j, --json`: Output in JSON format
- `-l, --limit <n>`: Maximum spaces to fetch (default: 50)
- `-o, --offset <n>`: Number of spaces to skip

### Connectors & Context Tree Management

| Command | Description |
|---------|-------------|
| `/connectors` | Manage agent connectors (skill, hook, mcp, or rules integration) |
| `/reset [-y] [directory]` | Reset context tree to empty state |

**Connector types:**
- `skill`: Modern integration with markdown skill files (SKILL.md)
- `mcp`: Model Context Protocol tools (brv-query, brv-curate)
- `hook`: Legacy IDE settings injection (Claude Code only)
- `rules`: Agent-specific rule files (universal fallback)

**Defaults:**
- Claude Code, Cursor: `skill`
- Amp, Codex, Gemini CLI, Github Copilot, Junie, Kilo Code, Kiro, Roo Code, Zed: `mcp`
- Antigravity, Augment Code, Cline, Qoder, Qwen Code, Trae.ai, Warp, Windsurf: `rules`

**Reset options:**
- `-y, --yes`: Skip confirmation prompt

### LLM Providers (BETA)

| Command | Description |
|---------|-------------|
| `/provider` | Connect to and switch between LLM providers |
| `/model` | Select a model from the active provider (OpenRouter) |

**Aliases:** `/providers` and `/connect` for `/provider`; `/models` for `/model`

### Session Management

| Command | Description |
|---------|-------------|
| `/new [-y]` | Start a fresh session (ends current session, clears conversation) |

**Options:**
- `-y, --yes`: Skip confirmation prompt

**Note:** Sessions are stateful and auto-resume after restart (retained for 30 days). Use `/new` to start fresh—this clears conversation history but does NOT affect the context tree.

### Project Setup

| Command | Description |
|---------|-------------|
| `/init [-f]` | Initialize a project with ByteRover |

**Options:**
- `-f, --force`: Force re-initialization without confirmation

### Authentication

| Command | Description |
|---------|-------------|
| `/login` | Authenticate with ByteRover using OAuth 2.0 + PKCE |
| `/logout [-y]` | Log out and clear authentication |

## Authentication

ByteRover CLI supports two authentication methods to suit different workflows.

### Authentication Methods

**1. OAuth 2.0 (Interactive)**
- Use `/login` in the REPL
- Opens browser for secure OAuth flow with PKCE
- Best for: Local development, interactive use

**2. API Key (Non-interactive)**
- Use `brv login --api-key <key>`
- No browser required
- Best for: CI/CD, automation, headless environments
- Get your key at [app.byterover.dev/settings/keys](https://app.byterover.dev/settings/keys)

### How OAuth Works

1. Run `/login` in the REPL to start authentication
2. Your browser opens to the ByteRover authorization page
3. After successful login, tokens are securely stored in your system keychain
4. All subsequent commands automatically use your stored credentials

### Security Features

- **PKCE flow**: Prevents authorization code interception attacks
- **System keychain**: Tokens stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service
- **Session tracking**: Each session includes a session key for request tracking
- **Auto-refresh**: Refresh tokens enable seamless credential renewal

## Configuration

### Project Configuration

When you run `/init`, a configuration file is created at `.brv/config.json` in your project directory containing:

- **Space ID**: The ByteRover workspace/space associated with this project
- **User information**: Your user ID and email
- **Project settings**: Project-specific configuration

### Global Configuration

User-level configuration is stored at `~/.config/brv/`:

```
~/.config/brv/
├── config.json    # Global settings and device ID
└── logs/          # Session logs for debugging
```

### Context Tree Structure

The context tree is stored in `.brv/context-tree/`:

```
.brv/context-tree/
├── Architecture/
│   ├── System Design/
│   │   └── context.md
│   └── Database Schema/
│       └── context.md
├── API/
│   ├── Authentication/
│   │   └── context.md
│   └── Endpoints/
│       └── context.md
└── Frontend/
    ├── Components/
    │   └── context.md
    └── State Management/
        └── context.md
```

**Note**: When you run `/push`, your context tree is uploaded to ByteRover's cloud storage for version control and team collaboration.

### Agent Connector Configuration

Connector configurations are stored based on type:

**Skill connectors** (Claude Code, Codex, Cursor, Github Copilot):
- **Project-scoped**: `.claude/skills/byterover/`, `.cursor/skills/byterover/`, `.github/skills/byterover/`
- **Global-scoped** (Codex): `~/.codex/skills/byterover/`
- Files: `SKILL.md`

**Hook connectors** (Claude Code legacy):
- `.claude/settings.local.json` (project-scoped)

**MCP connectors**:
- Managed via MCP configuration files (JSON/TOML)

**Rules connectors**:
- `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, etc. (varies by agent)

## Troubleshooting

### Session Logs

If you encounter issues, session logs are stored at `~/.config/brv/logs/`. Each session creates a timestamped log file (e.g., `brv-2024-01-15T10-30-00.log`) that can help diagnose problems.

### Instance Lock

ByteRover CLI ensures only one instance runs per project folder. If you see an "instance already running" message:

1. Check for another terminal with `brv` running in the same directory
2. If no other instance is visible, the lock file may be stale — it will auto-release on the next start

### Common Issues

| Issue | Solution |
|-------|----------|
| "REPL requires an interactive terminal" | Run `brv` directly in a terminal, not through piped commands |
| Authentication expires frequently | Run `/login` to refresh your session |
| Context tree not syncing | Check `/status` for sync status, then try `/push` or `/pull` |
| Rule files not generated | Ensure you're in a project directory with `.brv/` initialized |

## Getting Help

### In-REPL Help

Start typing `/` in the REPL to see available commands with tab completion.

### Command Help

```bash
# Get general help
brv --help
```

### Support

If you encounter issues or have questions:

1. Check the command help in the REPL
2. Run `/status` to review your project state
3. Visit the [ByteRover Docs](https://docs.byterover.dev)
4. Contact ByteRover support

---

**Copyright (c) ByteRover**
