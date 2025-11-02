# ByteRover CLI

Command-line interface for ByteRover, enabling seamless team/space management, authentication, and space's memory operations directly from your terminal.

[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## Table of Contents

* [Installation](#installation)
* [Quick Start](#quick-start)
* [What is ACE?](#what-is-ace)
* [Core Workflow](#core-workflow)
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
br --version
```

## Quick Start

Get started with ByteRover CLI in three simple steps:

### 1. Authenticate

```bash
br login
```

This opens your browser to complete OAuth authentication. Your credentials are securely stored in the system keychain.

### 2. Initialize a project

```bash
cd your-project-directory
br init
```

Select a space from your available spaces and configure your project.

### 3. Start using ByteRover

You're ready to use ByteRover commands in your project!

## What is ACE?

**Agentic Context Engineering (ACE)** is a systematic workflow that helps coding agents (like Claude Code, Cursor, etc.) capture their work, learn from feedback, and build cumulative knowledge in a living playbook.

Based on the research paper [**Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models**](https://arxiv.org/abs/2510.04618) by Dang et al., ACE enables language models to iteratively improve their performance through structured context evolution.

### Why Use ACE?

- **Build Knowledge**: Each task completed by an agent teaches the system
- **Learn from Experience**: Capture both successes and failures as insights
- **Context Persistence**: Maintain project-specific best practices that improve over time
- **Traceability**: Track what worked, what didn't, and why

## Core Workflow

ACE follows a simple 3-phase cycle that coding agents can use to improve over time:

### 1. Executor
Agent performs coding task and saves detailed output with context.

### 2. Reflector
Agent analyzes results and provides honest feedback on what worked and what didn't.

### 3. Curator
Agent transforms insights into playbook updates that are automatically applied to improve future work.

### Quick Example

If you're using a coding agent like Claude Code:

```bash
# Complete ACE workflow in a single command
br complete "auth-feature" \
  "Implemented JWT authentication with secure token handling" \
  "Successfully added OAuth2 authentication" \
  --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" \
  --feedback "All tests passed, auth works correctly"
```

For comprehensive ACE instructions for coding agents, check the corresponding coding agents' instruction files after `br init` or `br gen-rules`.

## Essential Commands

### Authentication

```bash
# Log in to ByteRover
br login

# Check your authentication and project status
br status
```

### Project Setup

```bash
# Initialize project with ByteRover
br init

# List available spaces
br space list

# Switch to a different space or team
br space switch
```

### Memory Operations

```bash
# Retrieve memories from ByteRover (outputs to stdout for agent context)
br retrieve --query "authentication best practices"
br retrieve -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"

# Push your playbook to ByteRover's memory storage
br push
```

### For Coding Agents

```bash
# Complete ACE workflow (recommended for agents)
br complete <hint> <reasoning> <answer> \
  --tool-usage <tools> \
  --feedback <feedback>

# Generate agent rules (sets up ACE workflow for your coding agent)
br gen-rules
```

## Authentication

ByteRover CLI uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange) for secure authentication.

### How it works

1. Run `br login` to start authentication
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

When you run `br init`, a configuration file is created at `.br/config.json` in your project directory containing:

- **Space ID**: The ByteRover workspace/space associated with this project
- **User information**: Your user ID and email
- **Project settings**: Project-specific configuration

### ACE File Structure

ACE stores all outputs in `.br/ace/`:

```
.br/ace/
├── playbook.json                # Your living knowledge base
├── executor-outputs/            # Coding task outputs
├── reflections/                 # Task analysis and feedback
└── deltas/                      # Playbook updates
```

**Note**: When you run `br push`, the playbook is uploaded to ByteRover's memory storage, and local ACE files are automatically cleaned up to keep your workspace organized.

## Getting Help

### Command Help

```bash
# Get general help
br help

# Get help for a specific command
br help login
br help init
br help push
```

### Support

If you encounter issues or have questions:

1. Check the command help: `br help [command]`
2. Review your status: `br status`
3. Contact ByteRover support

---

**Copyright (c) ByteRover**