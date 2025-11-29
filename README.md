# ByteRover CLI

Command-line interface for ByteRover, enabling seamless team/space management, authentication, and space's memory operations directly from your terminal.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## Important

Starting with version **0.2.0**, the ByteRover CLI command has been renamed from `br` to `brv` to avoid conflicts with [broot](https://github.com/Canop/broot), another popular CLI tool that also uses the `br` command.

This is a **breaking change** that requires action from existing users.

Please check the migration guide [here](https://docs.byterover.dev/beta/migration-br-brv).

## Table of Contents

* [Installation](#installation)
* [Quick Start](#quick-start)
* [What is Context Tree?](#what-is-context-tree)
* [Essential Commands](#essential-commands)
* [Authentication](#authentication)
* [Configuration](#configuration)
* [Getting Help](#getting-help)

## Installation

### Requirements

- **Node.js**: >= 18.0.0
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

### 1. Authenticate

```bash
brv login
```

This opens your browser to complete OAuth authentication. Your credentials are securely stored in the system keychain.

### 2. Initialize a project

```bash
cd to/your/project
brv init
```

Select a space from your available spaces and configure your project.

### 3. Start using ByteRover

You're ready to use ByteRover commands in your project!

## What is Context Tree?

The **Context Tree** is ByteRover's structured memory system that helps you and your coding agents organize, store, and retrieve project knowledge efficiently.

### Why Use Context Tree?

- **Organized Knowledge**: Structure your project knowledge by domain and topic
- **Easy Retrieval**: Find relevant context quickly when you need it
- **Persistent Memory**: Maintain project-specific knowledge across sessions
- **Agent-Friendly**: Works seamlessly with coding agents like Claude Code, Cursor, and others
- **Version Control**: Push and sync your context to ByteRover's cloud storage

### How It Works

The context tree organizes knowledge into:
- **Domains**: High-level categories (e.g., Architecture, API, Frontend)
- **Topics**: Specific subjects within domains (e.g., Authentication, Components)
- **Context Files**: Markdown files containing your actual knowledge

For comprehensive instructions for coding agents, check the generated rule files after running `brv gen-rules`.

## Essential Commands

### Authentication

```bash
# Log in to ByteRover
brv login

# Check your authentication and project status
brv status
```

### Project Setup

```bash
# Initialize project with ByteRover
brv init

# List available spaces
brv space list

# Switch to a different space or team
brv space switch
```

### Memory Operations

```bash
# Add content to context tree (interactive or autonomous)
brv add
brv add "User authentication uses JWT tokens"

# Push your context tree to ByteRover's memory storage
brv push
```

### For Coding Agents

```bash
# Generate agent rules (sets up context tree workflow for your coding agent)
brv gen-rules
```

## Authentication

ByteRover CLI uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange) for secure authentication.

### How it works

1. Run `brv login` to start authentication
2. Your browser opens to the ByteRover authorization page
3. After successful login, tokens are securely stored in your system keychain
4. All subsequent commands automatically use your stored credentials

### Security features

- **PKCE flow**: Prevents authorization code interception attacks
- **System keychain**: Tokens stored in macOS Keychain
- **Session tracking**: Each session includes a session key for request tracking
- **Auto-refresh**: Refresh tokens enable seamless credential renewal

## Configuration

### Project Configuration

When you run `brv init`, a configuration file is created at `.brv/config.json` in your project directory containing:

- **Space ID**: The ByteRover workspace/space associated with this project
- **User information**: Your user ID and email
- **Project settings**: Project-specific configuration

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

**Note**: When you run `brv push`, your context tree is uploaded to ByteRover's memory storage for version control and team collaboration.

## Getting Help

### Command Help

```bash
# Get general help
brv --help

# Get help for a specific command
brv login --help
brv init --help
brv push --help
```

### Support

If you encounter issues or have questions:

1. Check the command help: `brv [command] --help`
2. Review your status: `brv status`
3. Contact ByteRover support

---

**Copyright (c) ByteRover**