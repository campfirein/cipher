# Code Review: Phase 1 — Agent-Driven Graph (Curate DAG Cutover)

**Reviewer**: AI Code Review  
**Date**: 2026-04-27  
**Typecheck**: Clean | **Lint**: Clean (no new errors; 227 pre-existing warnings)

---

## Resolution Status (2026-04-27)

The four "act on now" findings are resolved. Two are deferred to Phase 2 with stable rationale; the rest remain as-flagged with status notes inline.

| # | Finding | Status |
|---|---|---|
| **1** | Layering violation (core → infra runtime imports) | ✅ **Fixed** |
| **2** | Dead `existing` param in `detectConflicts` | ✅ **Fixed** |
| **3** | Extract metrics per-chunk vs per-fact | ⏸ Deferred (Phase 2) |
| **4** | `as` type assertions in chunk-node / conflict-node | ✅ **Fixed** |
| **5** | Orphan-session AbortController | ⏸ Deferred (Phase 2 — confirmed acceptable) |
| **6** | Code-fence regex fragility | ⏸ Deferred (revisit on real failure) |
| **7** | AbortSignal propagation | ⏸ Deferred (Phase 2) |
| **8** | Dead regression tests | ✅ **Fixed** |
| 9 | `as` casts in dag-builder | Acknowledged — unavoidable for typed graph maps |
| 10 | Snapshot test self-aware | Positive feedback (no action) |
| 11 | Capture script "untracked" | Process note (commits with Phase 1) |
| 12 | Inline prompt engineering | Deferred (extract when adding more LLM-bound nodes in Phase 2) |

**Verification after fixes**: 135 tests passing across all Phase 1 + adjacent + new sandbox-naming + workspace + live-write suites; typecheck clean; lint 0 errors.

## Files Changed

### Modified (6)
- `package.json` — added `p-map` dependency
- `src/server/infra/executor/curate-executor.ts` — DAG cutover + parallel hoist
- `src/server/infra/daemon/agent-process.ts` — wires `searchService` to executor
- `test/unit/infra/executor/curate-executor.test.ts` — updated assertions for new path
- `test/integration/workspace/workspace-scoped-execution.test.ts` — deps object pattern

### New — Core Flow (12)
- `src/agent/core/curation/flow/types.ts` — `NodeSlot`, `NODE_SLOT_ORDER`
- `src/agent/core/curation/flow/dag-builder.ts` — builds linear 7-node DAG
- `src/agent/core/curation/flow/runner.ts` — Kahn's algorithm runner with `pMap`
- `src/agent/core/curation/flow/metrics.ts` — per-node timing collector
- `src/agent/core/curation/flow/services-adapter.ts` — live `NodeServices` wiring
- `src/agent/core/curation/flow/existing-memory-loader.ts` — context-tree lookup
- `src/agent/core/curation/flow/index.ts` — barrel export
- `src/agent/core/curation/flow/slots/contracts.ts` — slot contract registry
- `src/agent/core/curation/flow/slots/types.ts` — `SlotContract` interface
- `src/agent/core/curation/flow/slots/schemas.ts` — Zod I/O schemas for 7 slots
- `src/agent/core/curation/flow/nodes/*.ts` — 7 node implementations (recon/chunk/extract/group/dedup/conflict/write)

### New — Tests (19)
- `test/unit/agent/curate-flow/runner.test.ts`
- `test/unit/agent/curate-flow/dag-builder.test.ts`
- `test/unit/agent/curate-flow/metrics.test.ts`
- `test/unit/agent/curate-flow/slots/contracts.test.ts`
- `test/unit/agent/curate-flow/nodes/{recon,chunk,extract,group,dedup,conflict,write}-node.test.ts`
- `test/unit/executor/pre-compaction-orphan-session.test.ts`
- `test/integration/curate/dag-end-to-end.test.ts`
- `test/integration/curate/snapshot-parity.test.ts`
- `test/integration/curate/pre-compaction-hoist.test.ts`

### New — Scripts & Fixtures
- `scripts/capture-curate-baseline.ts` — baseline snapshot generator
- `test/fixtures/curation/{small,large}.txt` — input fixtures
- `test/fixtures/curation/baseline-{small,large}.json` — captured snapshots

---

## Critical (1)

### 1. `agent/core/` → `agent/infra/` runtime layering violation

**5 files** in `agent/core/curation/flow/` import **runtime values** from `agent/infra/`:

| File | Import |
|---|---|
| `nodes/recon-node.ts` | `recon` from `infra/sandbox/curation-helpers` |
| `nodes/chunk-node.ts` | `chunk` from `infra/sandbox/curation-helpers` |
| `nodes/group-node.ts` | `groupBySubject` from `infra/sandbox/curation-helpers` |
| `nodes/dedup-node.ts` | `dedup` from `infra/sandbox/curation-helpers` |
| `services-adapter.ts` | `executeCurate` from `infra/tools/implementations/curate-tool` |

The existing `core/` → `infra/` imports are all `import type` (type-only), which is acceptable. These 5 are **runtime** imports — a stronger boundary violation.

Per AGENTS.md: `agent/core/` is "interfaces/domain"; `agent/infra/` is implementations.

**Inconsistency**: extract, conflict, and write nodes properly use the `NodeServices` indirection, but recon/chunk/group/dedup bypass it and call helpers directly.

**Fix options**:
- Move node implementations and services-adapter to `agent/infra/curation/flow/`, keeping types/schemas/interfaces in `core/`
- Or inject all helpers via `NodeServices` (consistent with extract/conflict/write pattern)

**✅ Resolution (2026-04-27)**: Took option 1 — moved all 7 nodes + `dag-builder.ts` + `services-adapter.ts` + `existing-memory-loader.ts` to `src/agent/infra/curation/flow/`. `core/curation/flow/` now contains only abstractions: `types.ts`, `runner.ts`, `metrics.ts`, `slots/{contracts,schemas,types}.ts`, `index.ts`. All consumer imports updated (executor, tests, capture script). Verified: 135 tests pass, typecheck clean.

---

## Warnings (6)

### 2. Dead `existing` field in `initialInput`

**File**: `curate-executor.ts:110`

The executor passes `existing: []` in `initialInput`, but the live conflict service (`services-adapter.ts:81-116`) **ignores** the `existing` parameter and does its own lookup via `deps.lookupSubject`. Test stubs use the `existing` param, production doesn't — this **test/prod behavioral mismatch** can mask bugs.

**Fix**: Either populate `existing` from the executor or remove the `existing` parameter from the `detectConflicts` signature and rely solely on `lookupSubject`.

**✅ Resolution (2026-04-27)**: Removed the `existing` parameter from `NodeServices.detectConflicts` signature in `runner.ts` (now single-arg: `(facts) => Promise<...>`). Cleaned up `conflict-node.ts` (deleted the dead `readExistingFromCtx` helper that was the source of finding #4 too). Removed `existing: []` from `curate-executor.ts` `initialInput`. Updated the conflict-node test that was asserting the second arg. Production `services.detectConflicts` continues to source existing memory via the injected `lookupSubject` closure (its only path).

### 3. Extract metrics are per-chunk, not per-fact

**File**: `services-adapter.ts:123-127`

```typescript
return {
  facts,
  failed: facts.length === 0 ? 1 : 0,
  succeeded: facts.length === 0 ? 0 : 1,
  total: 1,
}
```

`succeeded` is 0 or 1 per chunk regardless of fact count. A chunk returning 0 facts counts as "failed" even if extraction ran correctly (no facts present). Consider using `facts.length` for `succeeded` and only counting actual parse failures for `failed`.

### 4. `as` type assertions in node implementations

**Files**: `conflict-node.ts:28`, `chunk-node.ts:23`

```typescript
// conflict-node.ts:28
return Array.isArray(init.existing) ? (init.existing as CurationFactLike[]) : []

// chunk-node.ts:23
const init = (ctx.initialInput ?? {}) as {context?: unknown}
```

AGENTS.md says: "Avoid `as Type` assertions — use type guards or proper typing instead." Consider using Zod's `safeParse` on the schema (already imported) or a type-narrowing function.

**✅ Resolution (2026-04-27)**: 
- `chunk-node.ts` — replaced the cast with a small Zod schema (`initialInputContextSchema = z.object({context: z.string()}).partial()`) parsed via `safeParse`. The narrowed `parsed.data.context` is now properly typed.
- `conflict-node.ts` — both casts deleted entirely. The `readExistingFromCtx` helper that contained them is gone (removed as part of finding #2's cleanup).

### 5. Orphan-session guard latency

**File**: `curate-executor.ts:104-109`

If compaction fails fast but `sessionPromise` is slow, the catch block `await sessionPromise.catch(...)` blocks until session creation resolves/rejects before propagating the error. An `AbortController` would cancel in-flight session creation immediately. Acceptable for Phase 1 but worth noting for Phase 2.

### 6. Code-fence regex is fragile

**File**: `services-adapter.ts:53-56`

```typescript
const cleaned = content
  .replace(/^```(?:json)?\n/, '')
  .replace(/\n```$/, '')
  .trim()
```

Only handles the most common code-fence format. Won't handle whitespace variants (` ``` json `) or multiple code fences. The `JSON.parse` fallback in the catch mitigates this, but the regex could strip valid content in edge cases.

### 7. No `AbortSignal` propagation

**File**: `runner.ts` — `NodeContext` declares `signal?: AbortSignal` but the runner never checks it. Esc cancellation won't interrupt an in-progress DAG run. The field is declared but unused.

---

## Info / Style (5)

### 8. Dead regression tests

**File**: `test/unit/infra/executor/curate-executor.test.ts:25-74`

The "sandbox variable naming" tests test behavior that the new DAG path no longer exercises. They pass because they test the sandbox directly, but the `describe('CurateExecutor (regression)')` context is misleading now that the executor doesn't use sandbox variables.

**✅ Resolution (2026-04-27)**: Moved the three UUID-variable-naming tests to a new file `test/unit/infra/sandbox/local-sandbox-uuid-variable-naming.test.ts` under `describe('LocalSandbox — UUID variable naming')` — the describe label now matches the actual subject under test. Removed them from `test/unit/infra/executor/curate-executor.test.ts` along with the now-unused `LocalSandbox` import. Header comment in the original file points to the new location.

### 9. `as` casts in dag-builder

**File**: `dag-builder.ts:32-38`

7 `as CurationNode<unknown, unknown>` casts to fit heterogeneous nodes into a uniform map. Somewhat unavoidable for graph typing, but AGENTS.md discourages `as` assertions. Consider a wrapper function with a type guard.

### 10. Snapshot parity test is self-aware (positive)

**File**: `test/integration/curate/snapshot-parity.test.ts:5-39`

Excellent documentation — clearly states what the test proves and doesn't prove, including the admission that true behavioral parity vs the old loop was not captured. High-quality self-documenting test.

### 11. `scripts/capture-curate-baseline.ts` is untracked

This script should be committed since `snapshot-parity.test.ts` depends on consistent baseline generation. If stub services change in the test without updating the capture script, baselines silently diverge.

### 12. Inline prompt engineering

**File**: `services-adapter.ts:36-43`

The `EXTRACTION_PROMPT_PREFIX` is a long multi-line string embedded in code. Consider extracting to `agent/resources/prompts/` YAML or `agent/resources/tools/` `.txt` file for consistency with other tool prompts.

---

## What's Done Well

- **Clean slot/node separation** — Pure nodes (recon, chunk, group, dedup) are side-effect-free; service-bound nodes (extract, conflict, write) delegate via injected `NodeServices`
- **Kahn's algorithm runner** — Correct topological sort with cycle detection, bounded concurrency via `pMap`, and per-node fail-open semantics
- **Comprehensive test coverage** — 19 test files covering every node individually, runner behavior (linear, diamond, cycles, concurrency), metrics, snapshot parity, and executor regression
- **Zod schema contracts** — Every slot has input/output schemas that tests validate against (`slotContracts.*.outputSchema.safeParse(result)`)
- **Metrics collector zero-fill** — All 7 slots always present in `nodeTimings`, no defensive lookups needed by consumers
- **Pre-compaction parallel hoist** — Legitimate latency improvement with correct orphan-session cleanup
- **`CurateExecutorDeps` pattern** — Constructor uses object deps instead of positional params, consistent with AGENTS.md (>3 params → object params)

---

## Recommended Priority

| Priority | Issue | Effort | Status (2026-04-27) |
|---|---|---|---|
| **Must fix before merge** | #1 Layering violation — move nodes + adapter to `infra/` | Medium | ✅ Fixed |
| **Should fix** | #2 Dead `existing` param — remove or populate | Small | ✅ Fixed (removed) |
| **Should fix** | #4 `as` assertions — use type guards | Small | ✅ Fixed (Zod safeParse) |
| **Should fix** | #8 Dead regression tests — rename or move | Small | ✅ Fixed (moved to sandbox/) |
| **Nice to have** | #3 Extract metrics accuracy | Small | ⏸ Deferred Phase 2 |
| **Nice to have** | #5 Orphan-session AbortController | Medium | ⏸ Deferred Phase 2 |
| **Nice to have** | #6 Code-fence regex robustness | Small | ⏸ Deferred (revisit on real failure) |
| **Nice to have** | #7 AbortSignal propagation | Medium | ⏸ Deferred Phase 2 |
| **Nice to have** | #11 Commit capture script | Trivial | Process — commits with Phase 1 |
| **Nice to have** | #12 Extract inline prompt | Small | ⏸ Deferred (Phase 2 sandboxing) |

---

## Files Changed in Resolution Round (2026-04-27)

### Moved (10 files)
- `src/agent/core/curation/flow/nodes/{recon,chunk,extract,group,dedup,conflict,write}-node.ts` → `src/agent/infra/curation/flow/nodes/`
- `src/agent/core/curation/flow/dag-builder.ts` → `src/agent/infra/curation/flow/`
- `src/agent/core/curation/flow/services-adapter.ts` → `src/agent/infra/curation/flow/`
- `src/agent/core/curation/flow/existing-memory-loader.ts` → `src/agent/infra/curation/flow/`

### Modified (8 files)
- `src/agent/core/curation/flow/runner.ts` — removed `existing` param from `NodeServices.detectConflicts`; added doc comment explaining why
- `src/agent/infra/curation/flow/nodes/conflict-node.ts` — removed `readExistingFromCtx` helper + the two `as` casts
- `src/agent/infra/curation/flow/nodes/chunk-node.ts` — replaced `as {context?: unknown}` cast with Zod `safeParse`
- `src/server/infra/executor/curate-executor.ts` — updated imports to `infra/curation/flow/`; removed dead `existing: []` from `initialInput`
- `scripts/capture-curate-baseline.ts` — updated imports
- `test/unit/infra/executor/curate-executor.test.ts` — removed UUID-variable-naming tests + unused `LocalSandbox` import; updated header comment
- `test/unit/agent/curate-flow/nodes/conflict-node.test.ts` — collapsed two now-obsolete tests asserting the removed `existing` param into one updated assertion
- All 7 node tests + dag-builder test + integration tests — import-path updates from `core/curation/flow/...` to `infra/curation/flow/...`

### New (1 file)
- `test/unit/infra/sandbox/local-sandbox-uuid-variable-naming.test.ts` — relocated UUID-variable-naming tests under the correct subject-under-test label

### Verification
- 135 tests passing
- `npm run lint` — 0 errors (227 pre-existing warnings)
- `npx tsc --noEmit` — clean
