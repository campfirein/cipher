# ByteRover CLI

Command-line interface for ByteRover, enabling seamless project management, authentication, and workspace operations directly from your terminal.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![Downloads/week](https://img.shields.io/npm/dw/byterover-cli.svg)](https://npmjs.org/package/byterover-cli)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

## Table of Contents

<!-- toc -->
* [Installation](#installation)
* [Quick Start](#quick-start)
* [Agentic Context Engineering (ACE)](#agentic-context-engineering-ace)
* [Authentication](#authentication)
* [Usage](#usage)
* [Commands](#commands)
* [Configuration](#configuration)
* [Development](#development)
* [Architecture](#architecture)
* [Plugin System](#plugin-system)
* [Contributing](#contributing)
* [License](#license)
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
# 1. Start a task
br ace executor start "Add user authentication" --with-playbook

# 2. After coding, save your work
br ace executor save "auth-feature" \
  "Implemented JWT authentication" \
  "Successfully added secure auth" \
  --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test"

# 3. Provide feedback
br ace reflector "All tests passed, auth works correctly"

# 4. Update playbook with insights
br ace curator
```

### For Coding Agents

**📘 Complete ACE Guide**: See [docs/ACE_AGENT_GUIDE.md](docs/ACE_AGENT_GUIDE.md) for comprehensive instructions on using ACE in your development workflow.

**Copy these instructions to your agent** (Claude Code, Cursor, Aider, etc.) to enable systematic learning and knowledge building. The guide includes:

- Complete workflow with all commands and flags
- JSON formats for reflections and delta operations
- Best practices for hint-based file naming
- Examples for common development scenarios

### ACE Commands

```bash
# Main ACE workflow
br ace executor start <task> [--with-playbook]     # Start task with optional playbook context
br ace executor save <hint> <reasoning> <answer>   # Save work with --bullet-ids and --tool-usage
br ace reflector <feedback>                        # Analyze results (paste reflection JSON)
br ace curator [--reflection file.json]            # Update playbook (paste delta JSON)

# Direct playbook manipulation (bypasses ACE workflow)
br add -s "Section" -c "Content"                   # Add new bullet (auto-generates ID)
br add -s "Section" -c "Updated" -b "bullet-id"    # Update existing bullet

# Memory operations
br mem push [--branch name]                        # Push playbook to blob storage and cleanup local files

# Utility commands
br show [--format json]                            # View current playbook
br ace stats                                       # View playbook statistics
br ace apply-delta [file.json]                     # Manually apply delta operations
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

The `br mem push` command uploads your playbook to ByteRover's memory storage (blob storage) and automatically cleans up local ACE files. This is useful when you want to:

- **Share playbook knowledge** with other team members or agents
- **Archive completed work** to cloud storage
- **Reset local state** after pushing insights to the system
- **Free up local storage** by removing processed ACE outputs

#### Usage

```bash
# Push to default branch (main)
br mem push

# Push to a specific branch
br mem push --branch develop
br mem push -b feature-auth
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

**Note**: When you run `br mem push`, all files in `executor-outputs/`, `reflections/`, and `deltas/` are removed after successful upload. The `playbook.json` is cleared (reset to empty). This keeps your local workspace clean while preserving your knowledge in ByteRover's blob storage.

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
<!-- usage -->
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
<!-- usagestop -->

## Commands
<!-- commands -->
* [`br add`](#br-add)
* [`br login`](#br-login)
* [`br foo`](#br-foo)
* [`br help [COMMAND]`](#br-help-command)
* [`br init`](#br-init)
* [`br status`](#br-status)
* [`br plugins`](#br-plugins)
* [`br plugins add PLUGIN`](#br-plugins-add-plugin)
* [`br plugins:inspect PLUGIN...`](#br-pluginsinspect-plugin)
* [`br plugins install PLUGIN`](#br-plugins-install-plugin)
* [`br plugins link PATH`](#br-plugins-link-path)
* [`br plugins remove [PLUGIN]`](#br-plugins-remove-plugin)
* [`br plugins reset`](#br-plugins-reset)
* [`br plugins uninstall [PLUGIN]`](#br-plugins-uninstall-plugin)
* [`br plugins unlink [PLUGIN]`](#br-plugins-unlink-plugin)
* [`br plugins update`](#br-plugins-update)

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

_See code: [src/commands/add.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/add.ts)_

## `br login`

Authenticate with ByteRover

```
USAGE
  $ br login

DESCRIPTION
  Authenticate with ByteRover
```

_See code: [src/commands/auth/login.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/auth/login.ts)_

## `br foo`

This command is used for interactive testing.

```
USAGE
  $ br foo

DESCRIPTION
  This command is used for interactive testing.
```

_See code: [src/commands/foo.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/foo.ts)_

## `br help [COMMAND]`

Display help for br.

```
USAGE
  $ br help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for br.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.33/src/commands/help.ts)_

## `br init`

Initialize a project with ByteRover

```
USAGE
  $ br init

DESCRIPTION
  Initialize a project with ByteRover

EXAMPLES
  $ br init
```

_See code: [src/commands/init.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/init.ts)_

## `br status`

Show CLI status and project information

```
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

_See code: [src/commands/status.ts](https://github.com/campfirein/byterover-cli/blob/v0.0.0/src/commands/status.ts)_

## `br plugins`

List installed plugins.

```
USAGE
  $ br plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ br plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/index.ts)_

## `br plugins add PLUGIN`

Installs a plugin into br.

```
USAGE
  $ br plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into br.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the BR_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the BR_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ br plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ br plugins add myplugin

  Install a plugin from a github url.

    $ br plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ br plugins add someuser/someplugin
```

## `br plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ br plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ br plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/inspect.ts)_

## `br plugins install PLUGIN`

Installs a plugin into br.

```
USAGE
  $ br plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into br.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the BR_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the BR_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ br plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ br plugins install myplugin

  Install a plugin from a github url.

    $ br plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ br plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/install.ts)_

## `br plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ br plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ br plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/link.ts)_

## `br plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins remove myplugin
```

## `br plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ br plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/reset.ts)_

## `br plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/uninstall.ts)_

## `br plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ br plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ br plugins unlink
  $ br plugins remove

EXAMPLES
  $ br plugins unlink myplugin
```

## `br plugins update`

Update installed plugins.

```
USAGE
  $ br plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/update.ts)_
<!-- commandsstop -->

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
* **BR_NPM_LOG_LEVEL** - npm log level for plugin installations
* **BR_NPM_REGISTRY** - npm registry for plugin installations

### Project Configuration

When you run `br init`, a configuration file is created at `.byterover/config.json` in your project directory. This file contains:

* **Space ID**: The ByteRover workspace/space associated with this project
* **Project settings**: Project-specific configuration

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

## Plugin System

ByteRover CLI supports oclif plugins for extensibility. The plugin system is provided by `@oclif/plugin-plugins`.

### Installing Plugins

```bash
# From npm registry
br plugins add myplugin

# From GitHub
br plugins add https://github.com/user/plugin
br plugins add user/plugin
```

### Managing Plugins

```bash
# List installed plugins
br plugins

# Inspect a plugin
br plugins inspect myplugin

# Update plugins
br plugins update

# Remove a plugin
br plugins remove myplugin

# Reset all plugins
br plugins reset
```

### Plugin Development

For plugin development, you can link a local plugin:

```bash
br plugins link /path/to/plugin
```

## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Ensure tests pass: `npm test`
5. Ensure linting passes: `npm run lint`
6. Commit your changes following conventional commit format
7. Push to your fork and submit a pull request

### Code Style

* Use explicit access modifiers (`public`, `private`, `readonly`)
* Prefer `const` for all variables
* Interface names prefixed with `I` (e.g., `IAuthService`)
* All imports require `.js` extension (TypeScript + Node16 module resolution)

### Testing Requirements

* All new features must include tests
* Maintain or improve test coverage
* Tests should follow existing patterns (see `test/` directory)

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) ByteRover
