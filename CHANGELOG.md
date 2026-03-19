# Changelog

All notable user-facing changes to ByteRover CLI will be documented in this file.

## [Unreleased]

### Added

- **`brv connectors sync` command** — Explicitly sync accumulated project knowledge into installed agent SKILL.md files. Run from the REPL with `/connectors sync` or from the CLI with `brv connectors sync`. Supports `--format json` for automation use cases.

### Removed

- **`brv-export-skill` MCP tool** — Removed. Use `brv connectors sync` (CLI) or `/connectors sync` (REPL) instead. Project knowledge is also synced automatically after every `brv curate` via the post-curation hook.

## [2.1.5]

### Added

- **`brv logout` command** — Disconnect from ByteRover cloud and clear stored credentials from the CLI. Supports `--format json` for headless/automation use cases.

### Fixed

- **Security dependency updates** — Patched `flatted`, `hono`, and `yauzl` to address security vulnerabilities.

## [2.1.4]

### Fixed

- **Local Ollama and OpenAI-compatible providers work without an API key** — Providers that do not require an API key (e.g. local Ollama) no longer trigger a "provider key missing" error. Only providers that actually require a key are flagged when one is absent.

## [2.1.3]

### Fixed

- **`brv restart` killing itself and hanging terminal** — Fixed an issue where `brv restart` could kill its own parent shell wrapper process (used by native binary installations via `install.sh`), causing garbled terminal output and hangs. The restart command now also force-exits after completion to prevent stale oclif plugin handles from blocking the process.

## [2.1.2]

### Changed

- **Default LLM model switched to Gemini 3.1 Flash Lite** — The default model for the ByteRover provider is now `gemini-3.1-flash-lite-preview`, replacing `gemini-3-flash-preview`, for improved performance and cost efficiency.

## [2.1.1]

### Changed

- **Skip update notifier for non-npm installations** - Update notifications are now suppressed when the CLI is not installed via `npm install -g`, preventing irrelevant update prompts for tarball and native binary users.
- **Auto-update frequency for native installations** - Configured oclif autoupdate with 1-day debounce for more reliable update checks on non-npm installations.

### Fixed

- **Security dependency updates** - Patched `fast-xml-parser`, `@aws-sdk/xml-builder`, and `@hono/node-server` to address security vulnerabilities.

## [2.1.0]

### Added

- **Agentic map system** - A new LLM-powered context map organizes knowledge hierarchically and enables smarter retrieval. Includes escalated compression strategies that adapt when context grows large, keeping responses accurate even for very large codebases.
- **`/exit` command** - Type `/exit` in the REPL to gracefully close the session (alternative to Ctrl+C).

### Changed

- **File-based storage** - Internal storage migrated from SQLite to plain files. Eliminates the native SQLite dependency for a simpler, more portable installation.

### Removed

- **Google Vertex AI provider** - The Vertex AI integration has been removed. Users relying on Google models should use Gemini via Gemini_API_key.

## [2.0.0]

### Added

- **Local-first mode** - CLI works without cloud authentication. A `.brv` directory is auto-created in the project root, and `/curate` and `/query` work fully offline.
- **Native binary installer** - Install on macOS and Linux without Node.js via `curl -fsSL https://byterover.dev/install.sh | sh`. Uninstaller script also available.
- **Multi-provider LLM support** - Connect to 20+ LLM providers via `/providers connect`: Anthropic, OpenAI, Google, Groq, Mistral, Perplexity, Cerebras, xAI, Together AI, and more.
- **OpenAI-compatible provider** - Use `--base-url` to connect custom endpoints such as Ollama, LM Studio, llama.cpp, vLLM, and LocalAI.
- **Google Vertex AI support** - Service account credential support via `-f` flag in `brv providers connect`.
- **Hub registry** - Browse, install, and manage skills and bundles from registries. Add custom registries with auth support via `brv hub registry add`.
- **Knowledge scoring** - Compound scoring system (BM25 + importance + recency) with maturity tiers (draft, validated, core). Frequently used knowledge rises; neglected knowledge decays.
- **YAML frontmatter for context files** - Context files now use structured YAML frontmatter (title, tags, related, keywords) instead of `## Relations` sections.
- **New agent connectors** - Added OpenClaw, OpenCode, and Auggie CLI integrations, bringing total supported agents to 22.
- **Consolidated skill connector** - Single `SKILL.md` file for agent skill integration replaces multi-file approach.
- **Daemon architecture** - A global background daemon enables fast CLI startup and shared connections. Use `brv restart` to restart the daemon.
- **Parallel task execution** - Concurrent curate and query operations (up to 5 tasks) via per-task child sessions.
- **API key login** - Authenticate with `brv login -k <key>` for non-interactive or headless environments.
- **Knowledge attribution** - Query responses include a footer showing which context tree sources contributed to the answer.
- **Linux ARM64 support** - Native binary builds now available for Linux aarch64.
- **Context tree merge improvements** - Backup and conflict directories created during sync. Auto-pull on space switch with local change preservation.
- **Fact extraction** - Automatic facts extraction from content during curation.

### Changed

- **(Breaking) Provider command renamed** - `/provider` is now `/providers` for both the TUI slash command and the oclif command.
- **(Breaking) Model switch command renamed** - `model set` is now `model switch`.
- **(Breaking) Default provider changed** - The default LLM provider is now ByteRover instead of OpenRouter.
- **(Breaking) Provider config cleared on upgrade** - Existing provider configurations are cleared; re-setup is required after upgrading.
- **Provider management restructured** - Provider commands are now `brv providers list/connect/disconnect/switch` subcommands.
- **Model management restructured** - Model commands are now `brv model list/switch` subcommands.
- **Context-window-aware token management** - Compaction and truncation thresholds now adapt to the active model's context window size.
- **Config structure simplified** - Cloud fields (spaceId, teamId, etc.) are now optional, supporting local-first usage.
- **Documentation moved** - Detailed docs moved to docs.byterover.dev; README simplified.

### Fixed

- **Agent pool race condition** - Fixed concurrent agent session management causing intermittent failures.
- **Cross-project context writes** - Agent process working directory now correctly scoped to prevent writing context to wrong project.
- **Hub list timeouts** - Fixed first-run timeout when loading hub registry.
- **Rate limit handling** - Provider-aware retry delays prevent excessive retries on rate-limited requests.
- **Input paste corruption** - Replaced ink-text-input with direct input handling to fix paste-related text corruption.
- **Stale data in TUI commands** - Disabled React Query cache for TUI commands to ensure fresh data.

### Removed

- **(Breaking) Keychain/Keytar support** - API key storage moved from system keychain to encrypted file-based storage. Re-entry of API keys required after upgrade.
- **Legacy OpenRouter content generator** - Replaced by the unified multi-provider AI SDK.
- **Old TUI views** - Removed init-view, login-view, main-view, and Tab bar in favor of page-based routing.

## [1.8.0]

### Added

- **Faster query responses** - Three-tiered response system: fuzzy cache matching for repeated queries (~50ms), direct search for high-confidence matches (~100-200ms), and optimized LLM responses with prompt caching and smart routing.
- **Out-of-domain detection** - Multi-layer detection prevents confidently wrong answers for topics not covered in the context tree, with AND-first search matching and relevance guards.
- **Diagram and visual content preservation** - Structured diagrams (Mermaid, PlantUML, ASCII art) are preserved verbatim during curation instead of being summarized.

### Changed

- **Improved folder curation** - New iterative extraction strategy for large directories avoids token limits. Default suggestion of `./` added in slash completion for curating current directory.
- **System prompt improvements** - Updated to be more general purpose and better respect source files instead of suggesting imports.

### Fixed

- **NPM security vulnerability** - Addressed high severity npm security issue.
- **File validator for text files** - Fixed rejection of known text file extensions (e.g., .md with UTF-16 encoding). Office documents (docx, xlsx, pptx) now pass validation.
- **Markdown newline formatting** - Fixed literal `\n` strings being rendered instead of actual newlines in generated markdown content.

## [1.7.2]

### Fixed

- **Sandbox TypeScript execution** - Added `esbuild` as a direct dependency to ensure TypeScript transpilation works reliably in the sandboxed code execution environment.

## [1.7.1]

### Fixed

- **Installation reliability** - Bundled `brv-transport-client` dependency to prevent installation failures when the GitHub-hosted package is unreachable.

## [1.7.0]

### Added

- **Folder reference support** - Use `@folder_path` syntax in `/curate` command to include entire directories. Files are packed into a structured format for comprehensive context curation. Also available in MCP `brv-curate` tool.
- **Escape key to cancel** - Press Esc to cancel streaming responses and long-running commands with timestamped cancellation feedback.
- **Improved onboarding flow** - Streamlined first-time setup with server-side onboarding state, auto-selection of default team/space, and clearer "What's Next" guidance for connector setup.
- **Query command alias** - Use `/q` as a shorthand for `/query` command.
- **Enhanced activity logs** - Activity logs now display code descriptions and file references for better traceability.

### Changed

- **Faster update checks** - Update notifier now checks every hour instead of every 24 hours for quicker access to new releases.
- **Improved query performance** - Query operations now use optimized programmatic search with sandboxed code execution for reduced latency.
- **Simplified agent architecture** - Removed subagent task delegation for more direct and responsive command execution.

### Fixed

- **NPM security vulnerabilities** - Addressed critical security issues identified in dependency audit.
- **Orphaned connector migration** - Fixed connector configuration migration when switching between connector types.
- **TUI layout stability** - Removed stray console output that could disrupt terminal UI rendering.
- **Context relation paths** - Relation paths in context.md files are now consistently normalized to lowercase with underscores.

## [1.6.0]

### Added

- **Headless mode for automation** - New `--headless` flag enables non-interactive CLI execution for CI/CD pipelines and automation. Supported commands: `init`, `status`, `curate`, `query`, `push`, `pull`.
- **JSON output format** - New `--format json` flag outputs structured newline-delimited JSON (NDJSON) for machine-readable results. Includes action lifecycle events, logs, warnings, errors, and structured results with timestamps.
- **Enhanced `brv init` flags** - New `--team`, `--space`, and `--force` flags for non-interactive project initialization. Team and space can be specified by name or ID.
- **File-based token storage for headless Linux** - Automatic fallback to file-based token storage when system keychain is unavailable (SSH sessions, containers, missing D-Bus). Enables seamless operation on headless Linux servers.

## [1.5.0]

### Added

- **External LLM provider support** - Connect to external providers like OpenRouter to access 200+ models. New `/provider` (aliases: `/providers`, `/connect`) command to connect and switch providers, and `/model` (aliases: `/models`) command to browse and select models with pricing, context window, favorites, and recent usage tracking. API keys stored securely in system keychain.
- **Reasoning/thinking display** - LLM reasoning and thinking content now appears in the execution progress view with an animated "Thinking..." indicator during streaming. Supports multiple model formats including Claude, OpenAI, Gemini, and DeepSeek.
- **Improved execution progress** - Custom status indicators (checkmark, blinking dot, X) for completed, running, and failed tool calls. Running items are prioritized to stay visible, and long tool commands are cleanly truncated.

### Changed

- **Model cost display** - Accurate input/output pricing shown separately (e.g., "$3.00/$15.00/M") with model descriptions displayed inline for better scannability.

### Fixed

- **OpenRouter streaming reliability** - Fixed TUI getting stuck on results and duplicate thinking entries when using OpenRouter models. Tool execution now runs in parallel for faster completion.
- **Directory listing path validation** - Fixed failures caused by double-resolved paths.
- **Task queue notifications** - Queued tasks now receive proper error notifications when dropped during reinitialization, instead of timing out silently.
- **Reasoning streaming states** - Fixed thinking indicator incorrectly reappearing when text response starts streaming.
- **NPM security vulnerabilities** - Updated dependencies to address moderate severity vulnerability.

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
