---
name: byterover
description: "You MUST use this for gathering contexts before any work. This is a Knowledge management for AI agents. Use `brv` to store and retrieve project patterns, decisions, and architectural rules in .brv/context-tree. Uses a configured LLM provider (default: ByteRover, no API key needed) for query and curate operations."
---

# ByteRover Knowledge Management

Use the `brv` CLI to manage your project's long-term memory.
Install: `npm install -g byterover-cli`
Knowledge is stored in `.brv/context-tree/` as human-readable Markdown files.

**No authentication needed.** `brv query`, `brv curate`, and `brv vc` (local version control) work out of the box. Login is only required for remote sync (`brv vc push`/`brv vc pull`).

## Workflow
1.  **Before Thinking:** Run `brv query` to understand existing patterns.
2.  **After Implementing:** Run `brv curate` to save new patterns/decisions.

## Commands

### 1. Query Knowledge
**Overview:** Retrieve relevant context from your project's knowledge base. Uses a configured LLM provider to synthesize answers from `.brv/context-tree/` content.

**Use this skill when:**
- The user wants you to recall something
- Your context does not contain information you need
- You need to recall your capabilities or past actions
- Before performing any action, to check for relevant rules, criteria, or preferences

**Do NOT use this skill when:**
- The information is already present in your current context
- The query is about general knowledge, not stored memory

```bash
brv query "How is authentication implemented?"
```

### 2. Curate Context
**Overview:** Analyze and save knowledge to the local knowledge base. Uses a configured LLM provider to categorize and structure the context you provide.

**Use this skill when:**
- The user wants you to remember something
- The user intentionally curates memory or knowledge
- There are meaningful memories from user interactions that should be persisted
- There are important facts about what you do, what you know, or what decisions and actions you have taken

**Do NOT use this skill when:**
- The information is already stored and unchanged
- The information is transient or only relevant to the current task, or just general knowledge

```bash
brv curate "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
```

**Include source files** (max 5, project-scoped only):

```bash
brv curate "Authentication middleware details" -f src/middleware/auth.ts
```

**View curate history:** to check past curations
- Show recent entries (last 10)
```bash
brv curate view
```
- Full detail for a specific entry: all files and operations performed (logId is printed by `brv curate` on completion, e.g. `cur-1739700001000`)
```bash
brv curate view cur-1739700001000
```
- List entries with file operations visible (no logId needed)
```bash
brv curate view detail
```
- Filter by time and status
```bash
brv curate view --since 1h --status completed
```
- For all filter options
```bash
brv curate view --help
```

### 3. Review Pending Changes
**Overview:** After a curate operation, some changes may require human review before being applied. Use `brv review` to list, approve, or reject pending operations.

**Use this when:**
- A curate operation reports pending reviews (shown in curate output)
- The user wants to check, approve, or reject pending changes

**Do NOT use this skill when:**
- There are no pending reviews (check with `brv review pending` first)

**Commands:**

List all pending reviews for the current project:
```bash
brv review pending
```

Sample output:
```
2 operations pending review

  Task: ddcb3dc6-d957-4a56-b9c3-d0bdc04317f3
  [UPSERT · HIGH IMPACT] - path: architecture/context/context_compression_pipeline.md
  Why:    Documenting switch to token-budget sliding window
  After:  Context compression pipeline switching from reactive-overflow to token-budget sliding window in src/agent/infra/llm/context/compression/

  [UPSERT · HIGH IMPACT] - path: architecture/tools/agent_tool_registry.md
  Why:    Documenting tool registry rewrite with capability-based permissions
  After:  Agent tool registry rewrite in src/agent/infra/tools/tool-registry.ts using capability-based permissions

  To approve all:  brv review approve ddcb3dc6-d957-4a56-b9c3-d0bdc04317f3
  To reject all:   brv review reject ddcb3dc6-d957-4a56-b9c3-d0bdc04317f3
  Per file:        brv review <approve|reject> ddcb3dc6-d957-4a56-b9c3-d0bdc04317f3 --file <path> [--file <path>]
```

Each pending task shows: operation type (ADD/UPDATE/DELETE/MERGE/UPSERT), file path, reason, and before/after summaries. High-impact operations are flagged.

Approve all operations for a task (applies the changes):
```bash
brv review approve <taskId>
```

Reject all operations for a task (discards pending changes; restores backup for UPDATE/DELETE operations):
```bash
brv review reject <taskId>
```

Approve or reject specific files within a task:
```bash
brv review approve <taskId> --file <path> --file <path>
brv review reject <taskId> --file <path>
```
File paths are relative to context tree (as shown in `brv review pending` output).

**Note**: Always ask the user before approving or rejecting critical changes.

**JSON output** (useful for agent-driven workflows):
```bash
brv review pending --format json
brv review approve <taskId> --format json
brv review reject <taskId> --format json
```

### 4. LLM Provider Setup
`brv query` and `brv curate` require a configured LLM provider. Connect the default ByteRover provider (no API key needed):

```bash
brv providers connect byterover
```

To use a different provider (e.g., OpenAI, Anthropic, Google), list available options and connect with your own API key:

```bash
brv providers list
brv providers connect openai --api-key sk-xxx --model gpt-4.1
```

### 5. Project Locations
**Overview:** List registered projects and their context tree paths. Returns project metadata including initialization status and active state. Use `-f json` for machine-readable output.

**Use this when:**
- You need to find a project's context tree path
- You need to check which projects are registered
- You need to verify if a project is initialized

**Do NOT use this when:**
- You already know the project path from your current context
- You need project content rather than metadata — use `brv query` instead

```bash
brv locations -f json
```

JSON fields: `projectPath`, `contextTreePath`, `isCurrent`, `isActive`, `isInitialized`.

### 6. Version Control
**Overview:** `brv vc` provides git-based version control for your context tree. It uses standard git semantics — branching, committing, merging, history, and conflict resolution — all working locally with no authentication required. Remote sync with a team is optional. The legacy `brv push`, `brv pull`, and `brv space` commands are deprecated — use `brv vc push`, `brv vc pull`, and `brv vc clone`/`brv vc remote add` instead.

**Use this when:**
- The user wants to track, commit, or inspect changes to the knowledge base
- The user wants to branch, merge, or undo knowledge changes
- The user wants to sync knowledge with a team (push/pull)
- The user wants to connect to or clone a team space
- The user asks about knowledge history or diffs

**Do NOT use this when:**
- The user wants to query or curate knowledge — use `brv query`/`brv curate` instead
- The user wants to review pending curate operations — use `brv review` instead
- Version control is not initialized and the user didn't ask to set it up

**Commands:**

Available commands: `init`, `status`, `add`, `commit`, `reset`, `log`, `branch`, `checkout`, `merge`, `config`, `clone`, `remote`, `fetch`, `push`, `pull`.

#### First-Time Setup

**Setup — local (no auth needed):**
```bash
brv vc init
brv vc config user.name "Your Name"
brv vc config user.email "you@example.com"
```

**Setup — clone a team space (requires `brv login`):**
```bash
brv login --api-key sample-key-string
brv vc clone https://byterover.dev/<team>/<space>.git
```

**Setup — connect existing project to a remote (requires `brv login`):**
```bash
brv login --api-key sample-key-string
brv vc remote add origin https://byterover.dev/<team>/<space>.git
```

#### Local Workflow

**Check status:**
```bash
brv vc status
```

**Stage and commit:**
```bash
brv vc add .                     # stage all
brv vc add notes.md docs/        # stage specific files
brv vc commit -m "add authentication patterns"
```

**View history:**
```bash
brv vc log
brv vc log --limit 20
brv vc log --all
```

**Unstage or undo:**
```bash
brv vc reset                     # unstage all files
brv vc reset <file>              # unstage a specific file
brv vc reset --soft HEAD~1       # undo last commit, keep changes staged
brv vc reset --hard HEAD~1       # discard last commit and changes
```

#### Branch Management

```bash
brv vc branch                    # list branches
brv vc branch feature/auth       # create a branch
brv vc branch -a                 # list all (including remote-tracking)
brv vc branch -d feature/auth    # delete a branch
brv vc checkout feature/auth     # switch branch
brv vc checkout -b feature/new   # create and switch
```

**Merge:**
```bash
brv vc merge feature/auth        # merge into current branch
brv vc merge --continue          # continue after resolving conflicts
brv vc merge --abort             # abort a conflicted merge
```

**Set upstream tracking:**
```bash
brv vc branch --set-upstream-to origin/main
```

#### Cloud Sync (Remote Operations)

Requires ByteRover authentication (`brv login`) and a configured remote.

**Manage remotes:**
```bash
brv vc remote                    # show current remote
brv vc remote add origin <url>   # add a remote
brv vc remote set-url origin <url>  # update remote URL
```

**Fetch, pull, and push:**
```bash
brv vc fetch                     # fetch remote refs
brv vc pull                      # fetch + merge remote commits
brv vc push                      # push commits to cloud
brv vc push -u origin main       # push and set upstream tracking
```

**Clone a space:**
```bash
brv vc clone https://byterover.dev/<team>/<space>.git
```

## Data Handling

**Storage**: All knowledge is stored as Markdown files in `.brv/context-tree/` within the project directory. Files are human-readable and version-controllable.

**File access**: The `-f` flag on `brv curate` reads files from the current project directory only. Paths outside the project root are rejected. Maximum 5 files per command, text and document formats only.

**LLM usage**: `brv query` and `brv curate` send context to a configured LLM provider for processing. The LLM sees the query or curate text and any included file contents. No data is sent to ByteRover servers unless you explicitly run `brv vc push`.

**Cloud sync**: `brv vc push` and `brv vc pull` require authentication (`brv login`) and sync knowledge with ByteRover's cloud service via git. All other commands operate without ByteRover authentication.

## Error Handling
**User Action Required:**
You MUST show this troubleshooting guide to users when errors occur.

"Not authenticated" | Run `brv login --help` for more details.
"No provider connected" | Run `brv providers connect byterover` (free, no key needed).
"Connection failed" / "Instance crashed" | User should kill brv process.
"Token has expired" / "Token is invalid" | Run `brv login` again to re-authenticate.
"Billing error" / "Rate limit exceeded" | User should check account credits or wait before retrying.

**Agent-Fixable Errors:**
You MUST handle these errors gracefully and retry the command after fixing.

"Missing required argument(s)." | Run `brv <command> --help` to see usage instructions.
"Maximum 5 files allowed" | Reduce to 5 or fewer `-f` flags per curate.
"File does not exist" | Verify path with `ls`, use relative paths from project root.
"File type not supported" | Only text, image, PDF, and office files are supported.

### Quick Diagnosis
Run `brv status` to check authentication, project, and provider state.
