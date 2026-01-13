# Changelog

All notable user-facing changes to ByteRover CLI will be documented in this file.

## [1.0.5]

### Added

- Stateful sessions with auto-resume - sessions now persist and can be resumed after restart
- `/new` command to start a fresh session (clears conversation history while preserving context tree)
- Two-part context model for curation - contexts now include both raw concept and narrative sections

### Changed

- `/clear` command renamed to `/reset` to avoid confusion with Unix `clear` command
- Upgraded default LLM to Gemini 3 Flash with thinking visualization support
- Improved curate prompt quality and handling of empty code snippets
- Knowledge relations now enforce consistent path format (`domain/topic/title.md`)

### Fixed

- File extension preserved correctly in knowledge relation paths
- Relation parser now handles file extensions and pattern matching more reliably
- Question marks removed from confirmation prompts for cleaner UI
- File paths now resolve correctly relative to project root (not working directory)
- Concurrent curation no longer gets stuck in queue state
- Improved stability during concurrent task execution

## [1.0.4]

### Added

- Task lifecycle status display in header showing active/completed tasks
- Initialization status indicator in header
- Dynamic domain creation for context tree - create new knowledge domains on the fly
- Step-based initialization UI with improved onboarding flow
- Actionable welcome prompt with quick-start suggestions
- Randomized example prompts in welcome screen
- WSL (Windows Subsystem for Linux) support with file-based token storage fallback
- Read-file tool pagination and line truncation for handling large files

### Changed

- Switched internal LLM service from gRPC to HTTP for improved reliability
- Sequential execution for `brv curate` commands to prevent conflicts

### Fixed

- Security vulnerability in query string parsing
- Double `@` prefix appearing in knowledge relations
- File validation when running `brv curate` from different directories
- Auth token validation now properly handles network errors
- SQLite database connection cleanup
- Agent initialization reliability improvements

## [1.0.2]

### Added

- Long-living agent with persistent task execution and restart support
- Responsive terminal UI with dynamic sizing and small-screen warnings
- Cross-platform path normalization for context tree
- Context tree structure injection into agent prompts
- Multimodal file reading support (images)
- Visual feedback when copying text
- Unified session logging across processes
- System sleep/wake detection for reliability

### Changed

- Updated onboarding UI with new visual design
- Context files use title-based naming with snake_case
- Improved `/query` accuracy with mtime sorting

### Removed

- `/chat` command removed (use `/curate` and `/query` instead)

### Fixed

- `/status` command now correctly detects changes
- Agent restart during onboarding
- Path duplication in read_file tool
- Empty directory creation during curation
- Application resizing issues
- Tab characters breaking terminal UI

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
