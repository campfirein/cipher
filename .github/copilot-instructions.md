# ByteRover CLI

oclif v4 TypeScript CLI. Clean Architecture: Commands → Services (infra) → Core (entities/interfaces).

## Critical Constraints

- **Imports**: MUST use `.js` extensions (Node16 module resolution)
- **Auth**: All API calls auto-inject `accessToken` + `sessionKey` via `AuthenticatedHttpClient`
- **Entities**: Immutable, implement `toJson()`/`fromJson()` (capital J)
- **Pagination**: Use `{fetchAll: true}` for UI selections (auto-paginates at 100/page)

## Commands

| Command | Critical Behavior |
|---------|-------------------|
| `brv login` | `fromJson()` returns `undefined` for old tokens (forces re-login) |
| `brv init` | `fetchAll: true` for teams/spaces. Creates `.brv/config.json` + context tree |
| `brv curate` | Interactive or autonomous mode. Adds context to context tree. Uses CipherAgent in autonomous mode |
| `brv query` | Autonomous agent that searches context tree. Returns retrieved information |
| `brv clear` | Resets context tree to 6 default domains. Requires confirmation unless `--yes` |
| `brv status` | Shows auth, config, context tree changes (git-style diff) |
| `brv space switch` | Updates config. **Does NOT** init context tree |
| `brv push` | Snapshots context tree and pushes to cloud storage |
| `brv gen-rules` | Generates agent-specific rule files. Prompts for agent selection. Templates in `src/templates/` |
| `brv watch` | [Dev only] Watches directories for file changes. Triggers parsing pipeline for IDE logs |
| `brv cipher-agent run` | [Dev only] Interactive/headless agent with session management. Supports `-c`/`-r` flags |

## CipherAgent

- **Autonomous mode**: Set `mode: 'autonomous'` in execute options
- **Event Bus**: All commands must setup listeners via `setupEventListeners()` for tool call progress
- **Sessions**: Use `randomUUID()` for session IDs. Format: `{timestamp}-{random}`
- **Exit Codes**: Use `exitWithCode()` from `exit-codes.ts`. Throws `ExitError` to suppress oclif error display
- **Tool Display**: Use `formatToolCall()` and `formatToolResult()` from `tool-display-formatter.ts`

## Testing

**Command Mocking**:
```typescript
class TestableCmd extends MyCmd {
  constructor(mockSvc, config) { super([], config); this.mockSvc = mockSvc }
  protected createServices() { return {mySvc: this.mockSvc} }
  protected async promptForSelection() { return this.mockSelection }
  public log() {} // suppress
  public error(e) { throw new Error(e.message || e) } // no console
  public warn(e) { return e } // no console
}
```
**HTTP**: Nock must verify `authorization` + `x-byterover-session-id`
**Services**: Stub `ContextTreeService` with `.resolves()`. Verify file operations

## Quick Ref

- **Env**: `BR_ENV=development|production`. URLs: `{dev|prod}-beta-*.byterover.dev/api/*`
- **OIDC**: 1h cache, 3 retries, 5s timeout, hardcoded fallback
- **Context Tree**: Stored in `.brv/context-tree/` with git-style snapshots
- **Default Domains**: `code_style`, `design`, `structure`, `compliance`, `testing`, `bug_fixes`
- **Dev-only**: Commands with `hidden: !isDevelopment()` only show in development
