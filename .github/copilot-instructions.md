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
| `brv init` | `fetchAll: true` for teams/spaces. Creates `.brv/config.json` + ACE structure |
| `brv space switch` | Updates config. **Does NOT** init ACE structure |
| `brv retrieve` | **Clears playbook first**. Combines memories+relatedMemories. Uses `transformRetrieveResultToPlaybook()` |
| `brv push` | GCS upload: PUT with `application/json`, **NO auth headers**. Must call confirm POST. Cleanup: playbook + ACE dirs |
| `brv add` | Direct playbook edit. Bypasses ACE workflow |

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
**Services**: Stub `PlaybookStore` with `.resolves()`. Verify defensive array copies

## Quick Ref

- **Env**: `BR_ENV=development|production`. URLs: `{dev|prod}-beta-*.byterover.dev/api/*`
- **OIDC**: 1h cache, 3 retries, 5s timeout, hardcoded fallback
- **Mapper**: `transformRetrieveResultToPlaybook()` in `infra/memory/memory-to-playbook-mapper.ts`
- **Utils**: `clearDirectory()` - files only, preserves dirs, handles ENOENT
