---
name: byterover-dream
description: "Use when consolidating, deduping, pruning, or organizing the ByteRover context tree via brv dream's three-phase scan → curate → finalize workflow."
---

# ByteRover Dream

`brv dream` is a three-phase deterministic pass over `.brv/context-tree/` that surfaces cleanup candidates (link, merge, prune, synthesize) for YOU to act on. No LLM is invoked on the daemon side — the daemon enumerates structural candidates, you do the semantic judgement via `brv curate` writes, then `brv dream finalize` archives the loser topics. The pipeline runs without any provider configured.

## When To Use Dream

- The user asks to consolidate, dedupe, prune, or organize the context tree.
- You notice the tree has accumulated near-duplicate or stale topics over time.
- You want to surface cross-link opportunities between adjacent topics.

## When NOT To Use Dream

- The tree is fresh or small (< ~10 topics) — there is nothing meaningful to clean up yet.
- The user only wants to search or query — use `brv query` / `brv search` instead.
- An open `brv curate` session is in flight — finish it first; do not interleave dream with curate sessions.

## Quick Reference

```bash
brv dream scan --format json
brv dream scan --kinds link,merge --scope security/ --max-candidates 20 --format json
brv dream finalize --session <sessionId> --archive testing/old-notes.html,redis/cache.html --format json
brv dream undo --format json
```

## Three-Phase Workflow

### Phase 1 — Scan

```bash
brv dream scan --format json
```

Returns a `sessionId` (uuid) and `candidates` keyed by kind. Hold the `sessionId` until Phase 3.

| Kind | Meaning | How to act |
|---|---|---|
| `link` | BM25-similar topic pairs not yet cross-linked | Extend each topic's `related=` attribute on `<bv-topic>` with the partner's path (comma-separated `@domain/topic` refs, no `.html` extension), then re-call `brv curate` at each existing path. The `path-exists` kickoff branch returns `existingContent`; merge your additions in and continue with `--overwrite`. |
| `merge` | BM25 near-duplicates | Pick a survivor, author HTML combining both topic bodies, write via the same `brv curate` `path-exists` / `--overwrite` flow at the survivor's existing path, then archive the loser in Phase 3. |
| `prune` | Low-importance or stale-mtime topics | Decide per candidate: archive in Phase 3, leave alone, or treat as a `merge` candidate against another topic. |
| `synthesize` | Per-domain topic groups plus existing synthesis topics | Author a new `<bv-topic>` at a fresh path under `synthesis/<slug>` and call `brv curate` — no `path-exists` branch applies because the path is new. |

Filter scope or kinds when the tree is large:

```bash
brv dream scan --kinds link,merge --scope security/ --max-candidates 20 --format json
```

### Phase 2 — Act

Invoke `brv curate` (per `curate.md`) for each candidate you decide to act on. Keep the `sessionId` from Phase 1 — you need it for finalize.

For `link` and `merge` actions, the existing topic path returns `kind: "path-exists"` on curate kickoff. Read `existingContent`, merge with your additions, and continue the same curate session with `--overwrite`. Never shrink the topic — enrichment only; every prior fact stays.

### Phase 3 — Finalize

```bash
brv dream finalize --session <sessionId> --archive testing/old-notes.html,redis/cache.html --format json
```

Archive paths MUST match exactly what `dream scan` emitted: full relative path under `.brv/context-tree/`, with `.html` extension. Files move to `.brv/archive/<path>` and a dream-log entry is written so the operation is undoable.

- `--archive` and `--archive-file <path>` are mutually exclusive; exactly one is required.
- The archive list is capped at 200 entries per call; split into multiple finalize calls for larger batches.

### Undo The Most Recent Finalize

```bash
brv dream undo --format json
```

Restores archived topics to their original locations (content byte-identical; mtime resets to current time). Curate writes from Phase 2 are NOT rolled back by undo — use `brv review reject <taskId>` for those (see `review.md`).

## Stateless v1 Notes

- `brv dream sessions` returns an empty list.
- `brv dream cancel --session <id>` is a no-op.
- The `sessionId` from scan is for your bookkeeping between scan and finalize; the daemon does not enforce or persist it.

## Red Flags — STOP

- About to call `brv dream finalize` before completing the Phase 2 curate writes → **STOP, finalize only archives losers; it does NOT preserve their content in the survivor.**
- About to pass an archive path that differs from what `dream scan` emitted (missing `.html`, different relative root) → **STOP, copy paths verbatim from the scan output.**
- About to run `brv dream undo` to roll back Phase 2 curate writes → **STOP, undo only reverses the most recent finalize; reject curate writes via `brv review reject`.**
- About to run dream on a tree with < ~10 topics → **STOP, there is nothing meaningful to consolidate yet.**
- About to shrink a merge survivor to "tidy" it → **STOP, enrichment only — every prior fact from both topics must survive.**

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Finalizing before Phase 2 curate writes complete | Run all Phase 2 curates first; finalize only archives, it does not preserve content |
| Shrinking the merge survivor to "tidy" the topic | Enrichment only — preserve every prior fact from both source topics |
| Re-running scan mid-session to refresh the candidate list | Hold one `sessionId` start-to-finish; restart only if you abandon the session |
| Skipping `--scope` on a large tree and drowning in candidates | Filter by `--scope <domain>/` or `--kinds <list>` for a manageable batch |
| Treating dream as a retrieval command | Dream consolidates, it does not retrieve; use `brv query` / `brv search` for recall |
| Using `brv dream undo` to revert curate writes from Phase 2 | Undo only reverses the most recent finalize archive operation; use `brv review reject <taskId>` for curate writes |
