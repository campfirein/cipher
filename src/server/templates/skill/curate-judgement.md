---
name: byterover-curate-judgement
description: "Use right after brv curate reports status: done — judge the written topic against curate.md's Quality Bar and do at most one enhancement pass."
---

# ByteRover Curate Judgement

A post-write self-review. After `brv curate` reports `status: "done"`, you authored the topic from memory; this step judges the **stored, rendered** topic with fresh eyes and, if it falls short, spends exactly **one** enhancement pass. It does not replace the pre-send self-check in `curate.md` — it catches what that missed once the artifact actually exists.

## When To Judge

- `brv curate` returned `status: "done"` for a **substantive** topic (a decision, a bug/fix, an architectural fact, a convention).
- The topic is load-bearing — future recall depends on it being complete.

## When NOT To Judge

- Trivial or transient one-fact topics, or anything the user told you not to block on.
- A detached curate you have not yet verified with `brv curate view <logId>` — verify completion first.
- An UPDATE/MERGE into a topic that was already reviewed and is known-good.
- You have already done one enhancement pass on this topic this session — the cap is reached, stop.

## The Judgement Pass

1. **Read the stored topic, not your memory.** Run `brv read <data.filePath>` (the path returned by the `done` envelope). Judge the rendered topic that consumers will actually retrieve — your authored HTML is not the signal.
2. **Score against the existing rubric.** Open the **`## Quality Bar`** section in `curate.md` and score the topic against its four dimensions (the why/decision trail, concrete evidence with `file:line`, structure & narrative, cross-links & coverage). Do **not** restate the rubric here — `curate.md` is the single source of truth; a second copy would drift.
3. **Verdict.**
   - Meets the bar on all four dimensions → done. Report `data.filePath`. Stop.
   - Falls short on any dimension → do exactly **one enhancement pass** (below), then stop regardless of the result.

## One Enhancement Pass (hard cap)

Re-curate the **same `path`**, merging the prior facts with the missing dimension (more decision trail, pasted `file:line` evidence, structure, or `related=` links). Continue the session and pass `--overwrite` (read `existingContent` first; preserve every prior fact — enrich, never shrink).

Then **STOP**. Accept the second result as-is. "It could still be richer" is not a reason to judge again — like curate's own validation cap, the loop is bounded on purpose. One pass buys most of the quality; further passes churn the file, spam `brv review pending`, and burn tokens for diminishing returns.

## Red Flags — STOP

- About to judge from the HTML you wrote instead of `brv read` → **STOP, read the stored topic.**
- About to start a second enhancement pass → **STOP, the cap is one.**
- About to re-paste the Quality Bar into your reasoning → **STOP, open `curate.md` and score against it.**
- About to re-curate under a *new* path "to be safe" → **STOP, overwrite the same path and merge.**

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Restating the Quality Bar in this file or your reasoning | Reference `curate.md`'s `## Quality Bar`; it is the single source of truth |
| Looping "judge → enhance" until perfect | Exactly one enhancement pass, then stop |
| Judging the HTML you authored from memory | `brv read <data.filePath>` and judge the stored, rendered topic |
| Re-curating into a fresh path | Overwrite the **same** path with `--overwrite`, merging prior facts |
| Shrinking the topic to "tidy" it | Enhancement only enriches; never drop a prior fact |
