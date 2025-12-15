# Changelog

All notable user-facing changes to ByteRover CLI will be documented in this file.

## [0.3.5]

### Added
- **Auto-update notification**: CLI now checks for updates every 24 hours and offers to update automatically via `npm update -g byterover-cli`
- **Legacy rule migration**: `brv gen-rules` now detects existing agent rules and creates backups before updating

### Fixed

- Fixed file write errors when parent directories don't exist
- Improved reliability of AI function calling
- Resolved security vulnerability
- Fixed race condition between update notification and welcome message display
