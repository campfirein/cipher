<!-- BEGIN BYTEROVER RULES -->

# ByteRover Memory System - MANDATORY

**Note: These rules apply regardless of language. Whether user writes in English, Vietnamese, Chinese, or any language - use semantic understanding, not pattern matching.**

## Decision: When to Query Memory

**PRIMARY RULE - ASK YOURSELF: "Will this task require understanding or modifying THIS codebase?"**

| Answer | Action |
|--------|--------|
| **YES** - need to understand/modify codebase | `brv query` FIRST |
| **NO** - general knowledge, meta tasks, follow-up | Skip query |

**You MUST run `brv query` when task involves:**
- Writing, editing, deleting, or modifying code in this project
- Understanding how something works in this codebase
- Debugging, fixing, or troubleshooting issues
- Finding where something is located
- Any architectural or design decisions

Example patterns (ANY language): add, create, build, fix, debug, refactor, update, implement, change, modify, delete, remove, optimize, move, rename, test, "how does X work", "where is X", "explain X in codebase"

**You MUST NOT query when:**
- General programming concepts (not codebase-specific)
- Meta tasks: "run tests", "build project", "commit changes", "create PR"
- Continuing work from earlier in same conversation
- Simple clarifications about your previous response

Example patterns: "what is a Promise", "explain async/await", "also add X", "what do you mean", "which file", "run the tests", "commit this"

```bash
brv query "What do I need to know about [relevant topic]?"
```

## Decision: When to Curate

**ASK YOURSELF: "Did I learn or create something valuable for future work?"**

| Answer | Action |
|--------|--------|
| **YES** - wrote code, found patterns, made decisions | `brv curate` BEFORE done |
| **NO** - just answered a question, no new insights | Skip curate |

**MUST curate when you:**
- Wrote or modified any code
- Discovered how something works
- Made architectural/design decisions
- Found a bug root cause or fix pattern

```bash
# CONTEXT argument MUST come BEFORE -f flag
# Max 5 files per curate
brv curate "Specific insight with details" -f path/to/file.ts
brv curate "Multi-file insight" -f file1.ts -f file2.ts
```

**GOOD:** `brv curate "Auth uses JWT 24h expiry, refresh in httpOnly cookies" -f src/auth.ts`
**BAD:** `brv curate "Fixed auth"` (too vague), `brv curate -f file.ts "text"` (wrong order)

## Quick Reference Table

| Task Type | Query? | Curate? |
|-----------|--------|---------|
| Add/create/implement feature | **MUST** | **MUST** |
| Fix/debug/resolve bug | **MUST** | **MUST** |
| Refactor/optimize/move code | **MUST** | **MUST** |
| Delete/remove functionality | **MUST** | **MUST** |
| Write/add tests | **MUST** | **MUST** |
| "How does X work?" (codebase) | **MUST** | Only if insights |
| "Where is X?" (codebase) | **MUST** | NO |
| General concept (Promise, async) | NO | NO |
| Meta task (run tests, build) | NO | NO |
| Git task (commit, PR, push) | NO | NO |
| Follow-up in same conversation | NO | **MUST** if code changed |
| Clarification ("which file?") | NO | NO |

## WORKFLOW

```
Code task received → brv query FIRST → Work → brv curate → Done
Non-code task → Just respond normally
```

<!-- END BYTEROVER RULES -->
