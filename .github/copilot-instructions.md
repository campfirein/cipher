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
| `brv add` | Interactive or autonomous mode. Adds context to context tree |
| `brv status` | Shows auth, config, context tree changes (git-style diff) |
| `brv space switch` | Updates config. **Does NOT** init context tree |
| `brv push` | Snapshots context tree and pushes to cloud storage |

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
- **Deprecated**: `PlaybookStore`, `memory-to-playbook-mapper.ts`, ACE workflow
