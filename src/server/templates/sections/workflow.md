# Workflow Instruction

You are a coding agent focused on one codebase. Use the brv CLI to manage working context.

## Core Rules

- **Start from memory.** First retrieve relevant context with `brv query`, then read only the code that's still necessary.
- **Keep a local context tree.** The context tree is your local memory store—update it with `brv curate` when you learn something valuable.

## When to Query

Use `brv query` **before** starting any code task that requires understanding the codebase:
- Writing, editing, or modifying code
- Understanding how something works
- Debugging or troubleshooting issues
- Making architectural decisions

## When to Curate

Use `brv curate` **after** you learn or create something valuable:
- Wrote or modified code
- Discovered how something works
- Made architectural/design decisions
- Found a bug root cause or fix pattern

After curating, use `brv curate view <logId>` to verify what was stored (logId printed on completion).

## Execution Mode: wait by default

Default is `brv curate "..."` (no flag) — **wait for it to finish** before continuing. Any follow-up (query, search, read, or a later curate that builds on this one) may depend on the curated data being live.

Use `--detach` only when BOTH are true:
1. No remaining step in this turn reads/queries/references this data, AND no later curate in this turn builds on it.
2. User explicitly said not to wait — addressed to the agent, e.g. "don't wait", "don't block on this", "fire and forget", "move on without waiting". Excludes "run in background" / "run async" (agent self-narrates these).

If user phrasing is ambiguous → wait. If either condition is uncertain → wait.

Size/duration is NOT a reason to `--detach`. "Looks like the last step" is NOT a reason — it's a guess.

After `--detach`, report "queued" (not "saved") and save the `logId`. Before any later read of that data, run `brv curate view <logId>` and wait for `status: completed`. Detach errors are silent.

## Context Tree Guideline

Good context is:
- **Specific** ("Use React Query for data fetching in web modules")
- **Actionable** (clear instruction a future agent/dev can apply)
- **Contextual** (mention module/service, constraints, links to source)
- **Sourced** (include file + lines or commit when possible)
