# Changelog

All notable user-facing changes to ByteRover CLI will be documented in this file.

## [1.4.0]

### Added

- **Antigravity agent support** - New coding agent integration using rules-based connector by default. Joins the 19 supported agents including Amp, Claude Code, Cursor, Windsurf, and others.
- **Improved PDF text extraction** - Increased default PDF page limit from 50 to 100 pages (max 200) with more efficient page-by-page processing for better handling of large documents.
- **Optional prompt for file references** - Made prompt optional when using `@file_path` references in `/curate` command and MCP `brv-curate` tool. The system infers context from referenced files when no explicit prompt is provided.

### Changed

- **Streamlined space switching** - Existing connector configuration is now preserved when switching spaces via `/space switch`, removing the redundant agent selection prompt.
- **Removed Node.js version warning** - Startup no longer displays Node.js version warnings. The Node.js >= 20.0.0 requirement remains enforced in package.json.

## [1.3.0]

### Added

- **Skill-based agent integration** - New integration method providing discoverable, markdown-based guidance for AI coding agents. Skills install as three comprehensive files (SKILL.md, TROUBLESHOOTING.md, WORKFLOWS.md) in your agent's skill directory, offering quick reference, troubleshooting guides, and detailed workflows. Available for Claude Code, Cursor, Codex, and GitHub Copilot.

### Changed

- **Claude Code default connector** - Changed from hook-based to skill-based integration for better discoverability and maintainability. Skills no longer modify IDE settings and provide more comprehensive guidance. Hook connector remains available for users who prefer it.
- **Cursor default connector** - Changed from MCP to skill-based integration for native skill support. Provides better integration through Cursor's skill system.
- **Task execution reliability** - Unified task queue with sequential processing (FIFO) prevents conflicts during concurrent curate and query operations. Tasks now execute predictably in order with improved cancellation and deduplication support.

### Fixed

- **Authentication error handling** - Improved error messages and recovery during OAuth token exchange and refresh flows
- **Windsurf rule file formatting** - Fixed YAML frontmatter ordering in generated rule files for correct parsing

## [1.2.1]

### Changed

- **Simplified command reference** - Generated rule files now include concise command list with `--help` guidance instead of detailed inline documentation

### Fixed

- **Socket connection stability** - Fixed duplicate event listeners accumulating after system wake-up, improving connection reliability
- **Sub-agent task display** - Fixed premature "Result:" message appearing during sub-agent task execution
- **NPM security vulnerabilities** - Updated dependencies to address security issues

## [1.2.0]

### Added

- **MCP server integration** - Model Context Protocol server enabling ByteRover context queries and curation from Claude Code, Cursor, Windsurf, and other coding agents via `brv-query` and `brv-curate` tools
- **Expandable message view** - Press Ctrl+O to expand any message to full-screen view with vim-style navigation (j/k for scrolling, g/G to jump to top/bottom)
- **Expandable log view** - Full-screen log inspection with scrollable output and keyboard navigation
- **Auto-create domain context files** - Domains automatically get context.md files created at multiple levels (domain, topic, subtopic) for better knowledge organization
- **Markdown rendering** - Improved formatting support for agent output with proper rendering of headings, lists, blockquotes, and code blocks

### Changed

- **Connector setup flow** - `/connectors` command now provides clearer MCP configuration instructions for supported coding agents
- **Increased suggestion visibility** - CLI suggestions list displays 7 items with improved scroll indicators
- **Version display** - Version number shows "(latest)" indicator when running the most current version

### Fixed

- **MCP connection stability** - Added auto-reconnect logic with exponential backoff and health checks to handle temporary socket disconnections
- **`/new` command session handling** - Fixed `/new` command to properly update agent's internal session ID, preventing messages from routing to old sessions
- **Task isolation** - Fixed taskId propagation in session events for proper concurrent task handling
- **`/curate` usage string** - Aligned `/curate` usage description with actual flag behavior
- **Context overflow handling** - Added token-based message compression for handling large conversation contexts

## [1.1.0]

### Added

- **IDE hook integration** - Support for injecting ByteRover context directly into Claude Code via hooks
- **PDF file reading** - Read and analyze PDF files with proper validation and magic byte detection
- **Knowledge search tool** - New `search_knowledge` tool for querying the context tree programmatically
- **System sleep/wake detection** - Improved reliability when user's machines sleep and wake

### Changed

- **Increased curation concurrency** - Curation tasks now run with concurrency of 3 (up from 1)
- **Improved query search** - Multi-perspective search strategy with few-shot examples and stop-word filtering
- **Better curate responses** - Curate agent now includes subtopic names in generated context
- **REPL-first error messages** - All error messages now reference REPL slash commands (e.g., `/init` instead of `brv init`)
- **Updated documentation URL** - Docs now point to production URL instead of beta

### Fixed

- **Binary file detection** - Replaced byte-level heuristics with UTF-8 aware detection; fixes false positives for files with emojis, CJK text, and box-drawing characters
- **PDF validation** - Reject fake PDFs (binary files with .pdf extension) using magic byte validation
- **Process reconnection** - Fixed race conditions in agent restart and improved transport reconnection with exponential backoff
- **Topic naming** - Fixed `_md` suffix appearing in topic and sub-topic names during curation
- **Pull sync filtering** - README.md at context-tree root is now filtered during pull to avoid syncing incorrect files
- **NPM security vulnerabilities** - Updated dependencies to address security issues

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
