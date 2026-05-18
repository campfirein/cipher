---
name: byterover-review
description: "Use when brv curate reports pending review or the user asks to inspect, approve, or reject pending ByteRover context-tree operations."
---

# ByteRover Review

Some curate operations require human review before ByteRover applies them to `.brv/context-tree/`. Pending review means the knowledge is not stored yet.

## When To Review

- `brv curate` reports pending review.
- The user asks to inspect pending context-tree operations.
- The user asks to approve or reject queued ByteRover changes.
- You need to verify whether a high-impact operation has been applied.

Do not approve or reject review operations without explicit user direction.

## Quick Reference

```bash
brv review pending --format json
brv review approve <taskId> --format json
brv review reject <taskId> --format json
brv review approve <taskId> --file architecture/auth.md --format json
brv review reject <taskId> --file architecture/auth.md --format json
```

## Review Protocol

Run `brv review pending --format json` first. Summarize the task id, operation type, affected file paths, impact level, and before/after summaries for the user.

Approve only when the user asks you to apply the pending changes. Reject only when the user asks you to discard them.

Use `--file <path>` to approve or reject individual files when a task has multiple operations and the user chooses a subset.

## Stored-Knowledge Rule

Do not treat a pending high-impact operation as stored knowledge until it is approved and applied. If the user asks whether a curate succeeded, distinguish "queued for review" from "saved".

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Saying pending review is already saved | Say it is pending and show what needs review |
| Approving review items on your own | Ask for explicit user approval first |
| Rejecting a whole task when only one file is bad | Use `--file <path>` for targeted resolution |
| Forgetting JSON output for agent workflows | Use `--format json` for structured review handling |
