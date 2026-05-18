---
name: byterover-vc
description: "Use when inspecting, committing, pulling, or pushing ByteRover context-tree changes with brv vc."
---

# ByteRover VC

`brv vc` is local version control for `.brv/context-tree`. It uses git-like commands for inspecting, staging, committing, branching, and syncing knowledge-base changes.

## When To Use VC

- The user asks to inspect, diff, commit, branch, merge, pull, or push context-tree changes.
- You need to check whether curated knowledge changed files.
- You need to prepare local context-tree changes for sync.
- The user asks about context-tree history.

Do not use destructive history commands unless the user explicitly asks.

## Quick Reference

```bash
brv vc status
brv vc diff
brv vc add .
brv vc commit -m "Document retry behavior"
brv vc log
brv vc branch
brv vc pull
brv vc push
```

## Local Workflow

Use `brv vc status` before changing VC state. Use `brv vc diff` to inspect content before staging. Stage with `brv vc add` and commit with a concise message when the user asks to preserve context-tree changes.

Remote sync requires authentication. If `brv vc push` or `brv vc pull` fails with authentication errors, direct the user to `brv login`.

## Safety

Avoid `brv vc reset`, hard resets, destructive checkout, or conflict resolution unless the user explicitly asks and the target state is clear.

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Committing context-tree changes without inspection | Run `brv vc status` and `brv vc diff` first |
| Running destructive reset commands casually | Ask for explicit user direction |
| Assuming remote sync works without auth | Check login/auth errors and tell the user |
| Using repo `git` commands for `.brv/context-tree` history | Use `brv vc` commands for ByteRover context-tree state |
