# ByteRover CLI

Command-line interface for ByteRover, enabling seamless project management, authentication, and workspace operations directly from your terminal.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

## Table of Contents

<!-- toc -->
* [Development Testing](#development-testing)
* [Installation](#installation)
* [Quick Start](#quick-start)
* [Agentic Context Engineering (ACE)](#agentic-context-engineering-ace)
* [Authentication](#authentication)
* [Usage](#usage)
* [Commands](#commands)
* [Configuration](#configuration)
* [Development](#development)
* [Architecture](#architecture)
<!-- tocstop -->

## Development Testing

Make sure you're on the `develop` branch.

Build:

```bash
npm run build
```

In `./bin/run.js`, change `process.env.BR_ENV` to `'development'`.

Run:

```bash
npm link
```

This will:

- Create a **folder symlink** `<npm_global_prefix>/lib/node_modules/<package_name>`
  which points to the **package's directory**.
- Create a symlink for **the package's bin**
  in
  `<npm_global_prefix>/bin/<package_bin_command_or_package_name>`
  which points to
  `<npm_global_prefix>/lib/node_modules/<package_name>/<path_to_executable>`.
- Register the package as being globally installed.

Once testing is done, the package can be "unlink" by:

```bash
npm uninstall -g package-name
```

## Installation

### Requirements

- **Node.js**: >= 22.0.0
- **Operating System**: macOS (keychain integration for secure token storage)

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

Select a workspace from your available spaces and configure your project.

### 3. Start using ByteRover

You're ready to use ByteRover commands in your project!

## Agentic Context Engineering (ACE)

**ACE** is a systematic workflow for coding agents (like Claude Code, Cursor, etc.) to capture their work, learn from feedback, and build cumulative knowledge in a living playbook.

This implementation is based on the research paper: [**Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models**](https://arxiv.org/abs/2510.04618) by Dang et al., which introduces a framework for language models to iteratively improve their performance through structured context evolution.

### Why Use ACE?

- **Build Knowledge**: Each task completed by an agent teaches the system
- **Learn from Experience**: Capture both successes and failures as insights
- **Context Persistence**: Maintain project-specific best practices that improve over time
- **Traceability**: Track what worked, what didn't, and why

### The ACE Workflow

ACE follows a 3-phase cycle:

1. **Executor** - Agent performs coding task and saves output with detailed context
2. **Reflector** - Agent analyzes results and provides honest feedback
3. **Curator** - Agent transforms insights into playbook updates (automatically applied)

### Quick ACE Example

```bash
# Complete ACE workflow in a single command
br complete "auth-feature" \
  "Implemented JWT authentication with secure token handling" \
  "Successfully added OAuth2 authentication" \
  --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" \
  --feedback "All tests passed, auth works correctly"

# Update an existing playbook bullet
br complete "auth-update" \
  "Improved error handling in auth flow" \
  "Better error messages for failed login" \
  --tool-usage "Edit:src/auth.ts" \
  --feedback "Tests passed" \
  --update-bullet "bullet-5"
```

### For Coding Agents

**📘 Complete ACE Guide**: See [rules](./src/templates/README.md) for comprehensive instructions on using ACE in your development workflow.

`br gen-rules` (integrated into `br init`) helps users quickly set up their coding agents with the ACE workflow.

### ACE Commands

```bash
# Complete ACE workflow (executor + reflector + curator in one command)
br complete <hint> <reasoning> <answer> \
  --tool-usage <tools> \
  --feedback <feedback> \
  [--bullet-ids <ids>] \
  [--update-bullet <id>]                           # Complete workflow: save, reflect, and update playbook

# Direct playbook manipulation (bypasses ACE workflow)
br add -s "Section" -c "Content"                   # Add new bullet (auto-generates ID)
br add -s "Section" -c "Updated" -b "bullet-id"    # Update existing bullet

# Memory operations
br push [--branch name]                            # Push playbook to blob storage and cleanup local files
br retrieve --query <text> [--node-keys <paths>]   # Retrieve memories from ByteRover and load into playbook

# Utility commands
br status                                          # View CLI status and playbook statistics
br clear [--yes]                                   # Reset playbook
```

#### Quick Add Command

For agents that need to quickly add context without the full ACE workflow:

```bash
# 1. First, check the current playbook
br show

# 2. Add a new bullet to an existing or new section
br add -s "Common Errors" -c "Always validate API responses before processing"

# 3. Update an existing bullet (use ID from br show)
br add -s "Common Errors" -c "Updated content" -b "common-00001"
```

The `add` command automatically tags bullets with `['manual']` and is ideal for quick knowledge capture during development.

### Memory Push

The `br push` command uploads your playbook to ByteRover's memory storage (blob storage) and automatically cleans up local ACE files. This is useful when you want to:

- **Share playbook knowledge** with other team members or agents
- **Archive completed work** to cloud storage
- **Reset local state** after pushing insights to the system
- **Free up local storage** by removing processed ACE outputs

#### Usage

```bash
# Push to default branch (main)
br push

# Push to a specific branch
br push --branch develop
br push -b feature-auth
```

#### What Gets Pushed

- `.br/ace/playbook.json` - Your accumulated knowledge base

#### What Gets Cleaned Up (After Successful Push)

After successfully uploading to blob storage, the command automatically:

1. **Clears playbook content** - Resets to empty playbook (file remains, content cleared)
2. **Removes executor outputs** - Deletes all files in `.br/ace/executor-outputs/`
3. **Removes reflections** - Deletes all files in `.br/ace/reflections/`
4. **Removes deltas** - Deletes all files in `.br/ace/deltas/`

**Note**: Cleanup only happens after successful upload. If the upload fails, your local files remain unchanged.

#### Example Output

```text
Requesting upload URLs... done
Loading playbook... done

Uploading files...
  Uploading playbook.json... ✓

Cleaning up local files...
  Clearing playbook... ✓
  Cleaning executor outputs... ✓ (3 files removed)
  Cleaning reflections... ✓ (2 files removed)
  Cleaning deltas... ✓ (5 files removed)

✓ Successfully pushed playbook to ByteRover memory storage!
  Branch: main
  Files uploaded: 1
```

#### Branches

The `--branch` parameter refers to **ByteRover's internal branching system**, not Git branches. This allows you to organize different versions of your playbook in blob storage (e.g., `main`, `develop`, `experimental`).

### File Organization

ACE stores all outputs in `.br/ace/` with hint-based naming for traceability:

```
.br/ace/
├── playbook.json                                    # Living knowledge base
├── executor-outputs/
│   └── executor-{hint}-{timestamp}.json            # Your coding work
├── reflections/
│   └── reflection-{hint}-{timestamp}.json          # Analysis and feedback
└── deltas/
    └── delta-{hint}-{timestamp}.json               # Playbook updates
```

**Note**: When you run `br push`, all files in `executor-outputs/`, `reflections/`, and `deltas/` are removed after successful upload. The `playbook.json` is cleared (reset to empty). This keeps your local workspace clean while preserving your knowledge in ByteRover's blob storage.

### Memory Retrieve

The `br retrieve` command fetches memories from ByteRover's Memora service and loads them to `stdout` as parts of the coding agents' current context. This is useful when you want to:

- **Access team knowledge** - Retrieve insights and best practices shared by your team
- **Find relevant context** - Search for specific topics or code patterns
- **Filter by files** - Narrow results to specific file paths using `--node-keys`
- **Start with knowledge** - Begin work with relevant memories already in your playbook

#### Retrieve Usage

```bash
# Retrieve memories by query
br retrieve --query "authentication best practices"

# Retrieve with file path filtering
br retrieve -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"

# Short form
br retrieve -q "database connection issues"
```

#### How Retrieve Works

1. **Searches** ByteRover's memory storage for matches to your query
2. **Filters** results by node keys (file paths) if specified
3. **Clears** your existing local playbook
4. **Loads** retrieved memories and related memories into `stdout`.

## Authentication

ByteRover CLI uses **OAuth 2.0 with PKCE** (Proof Key for Code Exchange) for secure authentication:

### How it works

1. Run `br login` to initiate authentication
2. A local callback server starts on a random port
3. Your default browser opens to the ByteRover authorization page
4. After successful authentication, tokens are securely stored in your system keychain
5. All subsequent commands automatically use your stored credentials

### Security features

- **PKCE flow**: Prevents authorization code interception attacks
- **System keychain**: Tokens stored using native OS secure storage (macOS Keychain)
- **Session tracking**: Each authentication session includes a session key for request tracking
- **Auto-refresh**: Refresh tokens enable seamless credential renewal

### Environment-aware

The CLI supports separate development and production environments:

- **Development**: Uses `./bin/dev.js` and points to dev authentication servers
- **Production**: Uses `./bin/run.js` and points to production servers

### Token storage

After authentication, the CLI stores:

- **Access token**: For API authorization (`Authorization: Bearer {token}`)
- **Refresh token**: For obtaining new access tokens
- **Session key**: For request tracking (`x-byterover-session-id` header)
- **Expiration time**: For automatic token refresh

All tokens are stored in your system keychain via the `keytar` library.

## Usage

```sh-session
$ npm install -g byterover-cli
$ br COMMAND
running command...
$ br (--version)
byterover-cli/0.0.0 darwin-arm64 node-v22.19.0
$ br --help [COMMAND]
USAGE
  $ br COMMAND
...
```

## Commands

* [`br add`](#br-add)
* [`br clear`](#br-clear)
* [`br complete`](#br-complete)
* [`br gen-rules`](#br-gen-rules)
* [`br help [COMMAND]`](#br-help-command)
* [`br init`](#br-init)
* [`br login`](#br-login)
* [`br push`](#br-push)
* [`br retrieve`](#br-retrieve)
* [`br space list`](#br-space-list)
* [`br space switch`](#br-space-switch)
* [`br status`](#br-status)

## `br add`

Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)

```txt
USAGE
  $ br add -c <value> -s <value> [-b <value>]

FLAGS
  -b, --bullet-id=<value>  Bullet ID to update (if not provided, a new bullet will be created)
  -c, --content=<value>    (required) Content of the bullet
  -s, --section=<value>    (required) Section name for the bullet

DESCRIPTION
  Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)

  This command allows agents to directly manipulate the playbook without going through
  the full ACE workflow (executor → reflector → curator → apply-delta). Use this for
  quick knowledge capture during development.

  Before using this command, run 'br show' to view existing sections and bullet IDs.

EXAMPLES
  $ br add --section "Common Errors" --content "Always validate API responses"

  $ br add --section "Common Errors" --bullet-id "common-00001" --content "Updated: Validate and sanitize API responses"

  $ br add -s "Best Practices" -c "Use dependency injection for better testability"
```

## `br clear`

Clear local ACE context (playbook) managed by ByteRover CLI

```txt
USAGE
  $ br clear [DIRECTORY] [-y]

ARGUMENTS
  DIRECTORY  Project directory (defaults to current directory)

FLAGS
  -y, --yes  Skip confirmation prompt

DESCRIPTION
  Clear local ACE context (playbook) managed by ByteRover CLI

EXAMPLES
  $ br clear

  $ br clear --yes

  $ br clear /path/to/project
```

## `br complete`

Complete ACE workflow: save executor output, generate reflection, and update playbook in one command

```txt
USAGE
  $ br complete HINT REASONING FINALANSWER -t <value> -f <value> [-b <value>] [-u <value>]

ARGUMENTS
  HINT         Short hint for naming output files (e.g., "user-auth", "bug-fix")
  REASONING    Detailed reasoning and approach for completing the task
  FINALANSWER  The final answer/solution to the task

FLAGS
  -b, --bullet-ids=<value>    Comma-separated list of playbook bullet IDs referenced
  -f, --feedback=<value>      (required) Environment feedback about task execution (e.g., "Tests passed", "Build failed")
  -t, --tool-usage=<value>    (required) Comma-separated list of tool calls with arguments (format: "ToolName:argument", e.g., "Read:src/file.ts,Bash:npm test")
  -u, --update-bullet=<value> Bullet ID to update with new knowledge (if not provided, adds new bullet)

DESCRIPTION
  Complete ACE workflow: save executor output, generate reflection, and update playbook in one command

  This command executes the full ACE (Agentic Context Engineering) workflow in a single step:
  1. Executor phase: Saves your task output with detailed context
  2. Reflector phase: Analyzes results and generates reflection
  3. Curator phase: Updates the playbook with new knowledge

EXAMPLES
  $ br complete "user-auth" "Implemented OAuth2 flow" "Auth works" --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" --feedback "All tests passed"

  $ br complete "validation-fix" "Analyzed validator" "Fixed bug" --tool-usage "Grep:pattern:\"validate\",Read:src/validator.ts" --bullet-ids "bullet-123" --feedback "Tests passed"

  $ br complete "auth-update" "Improved error handling" "Better errors" --tool-usage "Edit:src/auth.ts" --feedback "Tests passed" --update-bullet "bullet-5"
```

## `br gen-rules`

Generate rule instructions for coding agents to work with ByteRover correctly

```txt
USAGE
  $ br gen-rules

DESCRIPTION
  Generate rule instructions for coding agents to work with ByteRover correctly

  This command generates agent-specific rule files that provide instructions for coding agents
  (like Claude Code, Cursor, Aider, etc.) to work correctly with ByteRover CLI and the ACE workflow.

EXAMPLES
  $ br gen-rules
```

## `br login`

Authenticate with ByteRover

```txt
USAGE
  $ br login

DESCRIPTION
  Authenticate with ByteRover
```

## `br help [COMMAND]`

Display help for br.

```txt
USAGE
  $ br help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for br.
```

## `br init`

Initialize a project with ByteRover

```txt
USAGE
  $ br init

DESCRIPTION
  Initialize a project with ByteRover

EXAMPLES
  $ br init
```

## `br push`

Push playbook to ByteRover memory storage and clean up local ACE files

```txt
USAGE
  $ br push [-b <value>]

FLAGS
  -b, --branch=<value>  [default: main] ByteRover branch name (not Git branch)

DESCRIPTION
  Push playbook to ByteRover memory storage and clean up local ACE files

  This command uploads your playbook to ByteRover's memory storage and automatically cleans up
  local ACE files after successful upload. The cleanup includes:
  - Clearing playbook content
  - Removing executor outputs
  - Removing reflections
  - Removing deltas

EXAMPLES
  $ br push

  $ br push --branch develop

  $ br push -b feature-auth
```

## `br retrieve`

Retrieve memories from ByteRover Memora service and output as JSON

```txt
USAGE
  $ br retrieve -q <value> [-n <value>] [--compact]

FLAGS
  -n, --node-keys=<value>  Comma-separated list of node keys (file paths) to filter results
  -q, --query=<value>      (required) Search query string
  --compact                Output compact JSON (single line)

DESCRIPTION
  Retrieve memories from ByteRover Memora service and output as JSON

  This command fetches memories from ByteRover's memory storage based on your query.
  You can optionally filter results by specific file paths using the --node-keys flag.

EXAMPLES
  $ br retrieve --query "authentication best practices"

  $ br retrieve -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"

  $ br retrieve -q "database connection issues" --compact
```

## `br status`

Show CLI status and project information

```txt
USAGE
  $ br status

DESCRIPTION
  Show CLI status and project information

  Displays comprehensive information about your ByteRover CLI setup including:
  - CLI version
  - Authentication status (with user email if logged in)
  - Current working directory
  - Project initialization status (with connected space if initialized)

EXAMPLES
  $ br status
```

## `br space list`

List all spaces for the current team (requires project initialization)

```txt
USAGE
  $ br space list [-a] [-j] [-l <value>] [-o <value>]

FLAGS
  -a, --all             Fetch all spaces (may be slow for large teams)
  -j, --json            Output in JSON format
  -l, --limit=<value>   [default: 50] Maximum number of spaces to fetch
  -o, --offset=<value>  [default: 0] Number of spaces to skip

DESCRIPTION
  List all spaces for the current team (requires project initialization)

  This command lists all available spaces in the current team. By default, it shows 50 spaces.
  Use --all to fetch all spaces or use --limit and --offset for manual pagination.

EXAMPLES
  $ br space list

  $ br space list --all

  $ br space list --limit 10

  $ br space list --limit 10 --offset 20

  $ br space list --json
```

## `br space switch`

Switch to a different team or space (updates .br/config.json)

```txt
USAGE
  $ br space switch

DESCRIPTION
  Switch to a different team or space (updates .br/config.json)

  This command allows you to switch your project to a different team or space.
  It shows your current configuration, then prompts you to select a new team and space.
  The configuration is updated in .br/config.json.

EXAMPLES
  $ br space switch
```

## Configuration

### Environment Configuration

ByteRover CLI supports runtime environment selection:

* **Development Environment** (`./bin/dev.js`)
  * Issuer URL: `https://dev-beta-iam.byterover.dev/api/v1/oidc`
  * Client ID: `byterover-cli-client`
  * Scopes: `read`, `write`, `debug`

* **Production Environment** (`./bin/run.js`)
  * Issuer URL: `https://prod-beta-iam.byterover.dev/api/v1/oidc`
  * Client ID: `byterover-cli-prod`
  * Scopes: `read`, `write`

The environment is automatically set when you run the CLI:

```bash
# Development mode
./bin/dev.js [command]

# Production mode (installed globally)
br [command]
```

### Environment Variables

* **BR_ENV** - Runtime environment (`development` | `production`) - automatically set by launcher scripts

### Project Configuration

When you run `br init`, a configuration file is created at `.byterover/config.json` in your project directory. This file contains:

* **Space ID**: The ByteRover workspace/space associated with this project
* **Project settings**: Project-specific configuration
* **User's information**: User's ID and user's email.

## Development

### Clone and Setup

```bash
git clone https://github.com/campfirein/byterover-cli.git
cd byterover-cli
npm install
```

### Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### Test

```bash
# Run all tests
npm test

# Run a specific test file
npx mocha --forbid-only "test/path/to/file.test.ts"
```

Tests use Mocha + Chai and are organized in `test/` with subdirectories:

* `test/commands/` - Command integration tests
* `test/unit/` - Unit tests mirroring `src/` structure
* `test/learning/` - Learning/exploration tests

### Lint

```bash
npm run lint
```

Runs ESLint with oclif and prettier configurations.

### Run Locally

```bash
# Development mode (uses ts-node, points to dev environment)
./bin/dev.js [command]

# Production mode (uses compiled dist/, points to prod environment)
./bin/run.js [command]
```

### Create New Command

```bash
npx oclif generate command
```

### Distribution

```bash
# Create development tarball
npm run pack:dev

# Create production tarball
npm run pack:prod
```

## Architecture

ByteRover CLI follows **Clean Architecture** principles with a clear separation of concerns:

### Layers

* **Core Layer** (`src/core/`) - Domain logic independent of frameworks
  * `domain/entities/` - Business entities with validation and behavior
  * `domain/errors/` - Domain-specific error types
  * `interfaces/` - Port definitions (dependency inversion)

* **Infrastructure Layer** (`src/infra/`) - Concrete implementations using external dependencies
  * `auth/` - OAuth 2.0 + PKCE implementation
  * `http/` - HTTP clients and callback servers
  * `storage/` - Keychain token storage
  * `space/` - Space/workspace service implementations

* **Application Layer** (`src/commands/`) - oclif command definitions

### Key Technologies

* **[oclif](https://oclif.io) v4** - CLI framework with plugin system
* **TypeScript** - Strict mode, ES2022 target, Node16 modules
* **axios** - HTTP client for OAuth and API operations
* **express** - Local callback server for OAuth flows
* **keytar** - Secure system keychain access
* **Mocha + Chai** - Testing framework

### Detailed Documentation

For comprehensive architecture documentation, design patterns, and development guidelines, see [CLAUDE.md](CLAUDE.md).

Copyright (c) ByteRover
