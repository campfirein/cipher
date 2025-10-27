# ACE Workflow Guide for Coding Agents

**ACE (Agentic Context Engineering)** - Capture work, learn from feedback, build cumulative knowledge in a living playbook.

## Quick Start

```bash
br ace executor start "Add authentication" [--with-playbook]  # 1. Get task prompt with optional context
br ace executor save "auth" "Implemented OAuth2" "Auth works" --tool-usage "Read:auth.ts,Edit:auth.ts"
br ace reflector "Tests passed, works correctly"  # Paste reflection JSON via stdin
br ace curator  # Paste delta JSON via stdin, auto-applies to playbook
```

## The 3-Phase Cycle

**1. Executor** - Do work and save

```bash
br ace executor start <task> [--with-playbook]
br ace executor save <hint> <reasoning> <finalAnswer> [--bullet-ids "id1,id2"] [--tool-usage "Tool:arg"]
```

**2. Reflector** - Analyze (paste JSON via stdin): `br ace reflector <feedback>`

**3. Curator** - Update playbook (paste delta JSON via stdin): `br ace curator [--reflection file.json]`

## Direct Playbook Manipulation (Bypasses ACE Workflow)

For agents: Quick add/update without executor → reflector → curator cycle

```bash
br ace show                              # 1. FIRST: Check existing playbook
br add -s "Section" -c "Content"         # 2. Add new bullet (auto-generates ID)
br add -s "Section" -c "Updated" -b "id" # 3. Update existing bullet by ID
```

Agent workflow:

1. Run `br ace show` to view current sections and bullet IDs
2. Choose appropriate section or create new one
3. Use `br add` to add/update bullets directly

## Utility Commands

```bash
br ace show [--format json]              # View playbook
br ace stats [--format json]             # Statistics
br ace apply-delta [delta-file.json]     # Manually apply delta
br ace clear [--yes]                     # Reset playbook
```

## File Naming: `executor-{hint}-{timestamp}.json` → `reflection-{hint}-{timestamp}.json` → `delta-{hint}-{timestamp}.json`

## Best Practices

1. Use descriptive hints: `"auth-fix"` not `"fix"`
2. Capture tool usage: `"ToolName:argument"` (e.g., `"Read:src/auth.ts,Bash:npm test"`)
3. Reference bullets with `--bullet-ids` when applying playbook knowledge
4. Provide honest feedback (successes and failures)
