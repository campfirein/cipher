---
name: byterover-history
description: "Use when inspecting ByteRover query logs, curate history, or recent memory activity."
---

# ByteRover History

Use history commands to audit what ByteRover queried, curated, or queued. History is especially important before trusting detached curate work from a previous step.

## When To Inspect History

- You need to verify a detached `brv curate` completed.
- The user asks what was recently queried or curated.
- You are debugging whether memory recall happened.
- You need recall metrics or matched-doc details from prior queries.

Do not use history commands as a substitute for a fresh query when you need current project context.

## Quick Reference

```bash
brv curate view
brv curate view <logId> --format json
brv curate view --detail
brv query-log view
brv query-log view <id> --format json
brv query-log summary
brv query-log summary --last 7d
```

## Curate History

Use `brv curate view` to inspect recent curate runs. Use `brv curate view <logId> --format json` when verifying a detached curate before relying on it.

If a detached curate is still processing, wait or tell the user it is not complete. If it failed or was cancelled, report that status instead of treating the data as saved.

## Query History

Use `brv query-log view` to inspect recent query operations and matched docs. Use `brv query-log summary` for aggregate recall metrics such as coverage, cache behavior, and common topics.

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Trusting a detached curate without checking status | Verify with `brv curate view <logId> --format json` |
| Reading history instead of retrieving current context | Run fresh `brv query` and `brv swarm query` for new work |
| Reporting only a log id when the user asked what happened | Summarize status, files, and operations |
| Treating failed history entries as saved memory | Report the failure and re-curate if needed |
