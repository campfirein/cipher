# ByteRover CLI Agent Guide

## Commands

### `br add` - Capture Knowledge Locally

Add/update knowledge bullets in playbook. Non-destructive.

```bash
br add -s "Section" -c "Content"           # Add new
br add -s "Section" -c "Content" -b "id"  # Update existing
```

**When to use:** Capture insights during implementation (errors, patterns, decisions)
**Sections:** `Common Errors`, `Best Practices`, `Strategies`, `Lessons Learned`, `Architecture`, `Testing`
**Output:** Saves to `.br/ace/playbook.json`, displays with scores and file paths

### `br mem retrieve` - Get Memories from Storage
Search and retrieve memories

```bash
br mem retrieve -q "query"                          # Basic search
br mem retrieve -q "query" -n "file1.ts,file2.ts"  # Scoped to files
```

**When to use:** Before starting tasks to gather context


### `br mem push` - Share Knowledge to Storage
Push playbook to storage. **⚠️ CLEANS UP local files after success**

```bash
br mem push           # Push to main branch
```

**When to use:** After completing tasks or capturing valuable knowledge
**Branch:** ByteRover internal (NOT Git), defaults to `main`
**Cleanup:** Clears playbook, removes executor-outputs/, reflections/, deltas/
**Note:** Should confirm befor push

## Agent Workflow

```
1. br mem retrieve -q "context"     # Before: gather context
2. [Implement/code]                 # During: work on task
3. br add -s "Section" -c "insight" # During: capture learnings
4. br mem push                      # After: share knowledge
```

## Best Practices

**Retrieve:**
- Use specific queries: `"OAuth PKCE flow"` not `"auth"`
- Use `-n` to scope to relevant files
- Save local work first (retrieve overwrites)

**Add:**
- Use standard sections for consistency
- Be specific: include file paths, explain "why"
- Add frequently as you discover insights

**Push:**
- Push at natural breakpoints (end of feature/session)
- Use `main` for stable knowledge, branches for experimental
- Verify playbook has valuable content first

## Warnings
- `br mem push` **CLEANS UP** local files after success
