# Changelog

All notable user-facing changes to ByteRover CLI will be documented in this file.

## [0.4.1]

### Fixed

- `/status` command now correctly displays CLI version

### Changed

- Minimum Node.js version requirement increased from 18 to 20
- Simplified welcome banner by removing verbose onboarding instructions

## [0.4.0]

### Added

- **Interactive REPL mode**: Running `brv` with no arguments now starts an interactive terminal UI with a persistent session
- **Slash commands**: All core functionality is now available via slash commands in REPL mode:
  - `/login`, `/logout` - Authentication
  - `/init` - Project setup with team/space selection
  - `/status` - Show auth, config, and context tree state
  - `/curate` - Add context to context tree
  - `/push [--branch <name>]`, `/pull [--branch <name>]` - Cloud sync (default branch: `main`)
  - `/space list`, `/space switch` - Space management
  - `/gen-rules` - Generate agent-specific rule files
  - `/clear` - Reset context tree
  - `/query` - Query context tree
- **File references in curate**: Use `--files` flag to include file references in autonomous curation
- **Interactive onboarding**: New guided onboarding flow for first-time users (press Esc to skip)

### Changed

- **Command renamed**: `reset` command is now `/clear` in REPL mode

### Fixed

- Improved UI responsiveness and layout
- Fixed terminal scrolling issues
- Fixed UI flickering during long-running operations
- Fixed tool error display showing 'undefined'

## [0.3.5]

### Added

- **Auto-update notification**: CLI now checks for updates every 24 hours and offers to update automatically via `npm update -g byterover-cli`
- **Legacy rule migration**: `brv gen-rules` now detects existing agent rules and creates backups before updating

### Fixed

- Fixed file write errors when parent directories don't exist
- Improved reliability of AI function calling
- Resolved security vulnerability
- Fixed race condition between update notification and welcome message display
