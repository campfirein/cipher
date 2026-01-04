# ByteRover CLI

Command-line interface for ByteRover, featuring an interactive REPL with a modern React/Ink terminal UI for managing your project's context tree and knowledge storage. Seamlessly integrate with AI coding agents like Claude Code, Cursor, Windsurf, and GitHub Copilot.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

## Table of Contents

* [Installation](#installation)
* [Quick Start](#quick-start)
* [Interactive REPL](#interactive-repl)
* [What is Context Tree?](#what-is-context-tree)
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

### Install globally via npm

```bash
npm install -g byterover-cli
```

### Verify installation

```bash
brv --version
```

## Quick Start

Visit [**ByteRover's Beta Docs**](https://docs.byterover.dev/beta) for more information.

Get started with ByteRover CLI in three simple steps:

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
- **Streaming Output**: Live responses from AI-powered operations
- **File References**: Type `@` in curate mode to browse and attach files

### Using Commands

In the REPL, use slash commands (commands prefixed with `/`) to interact with ByteRover:

```
/status              # Check your project status
/curate              # Add context interactively
/push                # Push changes to cloud
```

Commands support tab completion for quick navigation.

## What is Context Tree?

The **Context Tree** is ByteRover's structured knowledge system that helps you and your AI coding agents organize, store, and retrieve project context efficiently.

### Why Use Context Tree?

- **Organized Knowledge**: Structure your project knowledge by domain and topic
- **Easy Retrieval**: Find relevant context quickly when you need it
- **Persistent Memory**: Maintain project-specific knowledge across sessions
- **Agent-Friendly**: Works seamlessly with AI coding agents like Claude Code, Cursor, Windsurf, and GitHub Copilot
- **Cloud Sync**: Push and sync your context tree to ByteRover's cloud storage for backup and team collaboration
- **Dynamic Domains**: Automatically creates new domains as your knowledge grows

### How It Works

The context tree organizes knowledge into:
- **Domains**: High-level categories (e.g., Architecture, API, Frontend) — created automatically or manually
- **Topics**: Specific subjects within domains (e.g., Authentication, Components)
- **Context Files**: Markdown files containing your actual knowledge

### Integrating with Coding Agents

Use `/gen-rules` to generate rule instruction files that help your AI coding agents understand and work with ByteRover:

```
/gen-rules
```

This creates agent-specific rule files (e.g., `CLAUDE.md`, `.cursorrules`) that instruct the agent how to read from and contribute to your context tree.

## Slash Commands Reference

### Core Workflow

| Command | Description |
|---------|-------------|
| `/status` | Show CLI status and project information |
| `/curate [context] @files` | Curate context to the context tree |
| `/query <question>` | Query and retrieve information from the context tree |

**Curate examples:**
```
/curate                                    # Interactive mode
/curate "Auth uses JWT tokens"             # Autonomous mode with text
/curate "API docs" @src/api.ts @README.md  # With file references (max 5)
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

### Context Tree Management

| Command | Description |
|---------|-------------|
| `/gen-rules` | Generate rule files for AI coding agents (Claude Code, Cursor, etc.) |
| `/clear [-y] [directory]` | Reset context tree to default domains |

**Clear options:**
- `-y, --yes`: Skip confirmation prompt

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

ByteRover CLI uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange) for secure authentication.

### How it works

1. Run `/login` in the REPL to start authentication
2. Your browser opens to the ByteRover authorization page
3. After successful login, tokens are securely stored in your system keychain
4. All subsequent commands automatically use your stored credentials

### Security features

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
3. Visit [ByteRover Docs](https://docs.byterover.dev)
4. Contact ByteRover support

---

**Copyright (c) ByteRover**
