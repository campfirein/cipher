# ACE Workflow Guide for Coding Agents

**ACE (Agentic Context Engineering)** - Capture work, learn from feedback, build cumulative knowledge.

## Quick Start

```bash
# One command - fully automatic!
br ace complete "auth" \
  "Implemented OAuth2 flow following existing patterns" \
  "Successfully added authentication with JWT tokens" \
  --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" \
  --feedback "All tests passed"
```

Automatically: saves output → generates reflection → updates playbook. Done!

## Command Reference

```bash
# Main workflow - ADD mode (default)
br ace complete <hint> <reasoning> <finalAnswer> \
  --tool-usage "Tool:arg,Tool:arg" \
  --feedback "outcome" \
  [--bullet-ids "id1,id2"]

# Main workflow - UPDATE mode
br ace complete <hint> <reasoning> <finalAnswer> \
  --tool-usage "Tool:arg,Tool:arg" \
  --feedback "outcome" \
  --update-bullet "bullet-id"

# Quick playbook manipulation
br ace show                              # View playbook
br add -s "Section" -c "Content"         # Add bullet
br add -s "Section" -c "Updated" -b "id" # Update bullet

# Utilities
br ace stats [--format json]             # Statistics
br ace clear [--yes]                     # Reset playbook
```

## ADD vs UPDATE Mode

**ADD Mode (default)**: Creates a new bullet in the playbook

- Omit `--update-bullet` flag
- Adds new knowledge to "Lessons Learned" section
- Use for capturing new insights

**UPDATE Mode**: Updates an existing bullet with new knowledge

- Provide `--update-bullet "bullet-id"` flag
- Requires bullet ID to exist in playbook (validated before update)
- Updates content and metadata (files, tags, timestamp)
- Use when refining or expanding existing knowledge

## What Happens

1. **Executor**: Saves your work to `.br/ace/executor-outputs/`
2. **Reflector**: Auto-generates reflection from feedback → `.br/ace/reflections/`
3. **Curator**: Auto-generates delta, adds/updates key insight in "Lessons Learned" → `.br/ace/deltas/`

All non-interactive. No stdin required.

## Examples

### ADD Mode (Creating New Knowledge)

```bash
br ace complete "user-auth" \
  "Implemented OAuth2 with JWT. Followed patterns in src/auth.ts. Added error handling." \
  "Added user authentication with JWT validation. All edge cases handled, tests pass." \
  --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" \
  --feedback "All 15 tests passed. Works in dev and prod."

# Output:
# ✅ ACE WORKFLOW COMPLETED SUCCESSFULLY!
# Summary: 1 ADD operation, playbook updated
```

### UPDATE Mode (Refining Existing Knowledge)

```bash
# First, find the bullet ID you want to update
br ace show

# Then update it with new knowledge
br ace complete "auth-improvement" \
  "Added rate limiting to OAuth2 flow. Prevents brute force attacks." \
  "Improved authentication security with rate limiting and better error messages." \
  --tool-usage "Edit:src/auth.ts,Edit:src/middleware/rate-limit.ts" \
  --feedback "Tests passed. Verified rate limiting works." \
  --update-bullet "bullet-5"

# Output:
# ✅ ACE WORKFLOW COMPLETED SUCCESSFULLY!
# Summary: 1 UPDATE operation, playbook updated
```

## Best Practices

**Arguments matter - they generate your knowledge base!**

- **`<hint>`**: Short ID (e.g., `"auth-fix"`) - used for file naming
- **`<reasoning>`**: WHY you chose this approach (2-3 sentences)
- **`<finalAnswer>`**: What you accomplished - **becomes playbook content!**
- **`--tool-usage`**: Format: `"Tool:arg,Tool:arg"` (e.g., `"Read:file.ts,Edit:file.ts"`) - **Files automatically tracked in bullet metadata!**
- **`--feedback`**: Test results, successes, failures - analyzed for errors
- **`--bullet-ids`**: Optional. Reference bullets you used (e.g., `"bullet-123"`)

**Auto-generation mapping:**

- `finalAnswer` → Key insight in playbook
- `feedback` → Error identification (looks for "fail", "error" keywords)
- `reasoning` + `feedback` → Reflection analysis
- `toolUsage` → Extracted file paths stored in bullet's `relatedFiles` array

**Good inputs = Good knowledge capture!**
