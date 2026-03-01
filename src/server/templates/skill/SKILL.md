---
name: byterover
description: "You MUST use this for gathering contexts before any work. This is a Knowledge management for AI agents. Use `brv` to store and retrieve project patterns, decisions, and architectural rules in .brv/context-tree. Uses a configured LLM provider (default: ByteRover, no API key needed) for query and curate operations."
---

# ByteRover Knowledge Management

Use the `brv` CLI to manage your project's long-term memory.
Install: `npm install -g byterover-cli`
Knowledge is stored in `.brv/context-tree/` as human-readable Markdown files.

**No authentication needed.** `brv query` and `brv curate` work out of the box. Login is only required for cloud sync (`push`/`pull`/`space`) — ignore those if you don't need cloud features.

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
**Overview**: Analyze and save knowledge to the local knowledge base. Uses a configured LLM provider to categorize and structure the context you provide.

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

### 3. LLM Provider Setup
`brv query` and `brv curate` require a configured LLM provider. Connect the default ByteRover provider (no API key needed):

```bash
brv providers connect byterover
```

To use a different provider (e.g., OpenAI, Anthropic, Google), list available options and connect with your own API key:

```bash
brv providers list
brv providers connect openai --api-key sk-xxx --model gpt-4.1
```

### 4. Cloud Sync (Optional)
**Overview:** Sync your local knowledge with a team via ByteRover's cloud service. Requires ByteRover authentication.

**Setup steps:**
1. Log in: Get an API key from your ByteRover account and authenticate:
```bash
brv login --api-key sample-key-string
```
2. List available spaces:
```bash
brv space list
```
Sample output:
```
brv space list
1. human-resources-team (team)
   - a-department (space)
   - b-department (space)
2. marketing-team (team)
   - c-department (space)
   - d-department (space)
```
3. Connect to a space:
```bash
brv space switch --team human-resources-team --name a-department
```

**Cloud sync commands:**
Once connected, `brv push` and `brv pull` sync with that space.
```bash
# Pull team updates
brv pull

# Push local changes
brv push
```

**Switching spaces:**
- Push local changes first (`brv push`) — switching is blocked if unsaved changes exist.
- Then switch:
```bash
brv space switch --team marketing-team --name d-department
```
- The switch automatically pulls context from the new space.

## Data Handling

**Storage**: All knowledge is stored as Markdown files in `.brv/context-tree/` within the project directory. Files are human-readable and version-controllable.

**File access**: The `-f` flag on `brv curate` reads files from the current project directory only. Paths outside the project root are rejected. Maximum 5 files per command, text and document formats only.

**LLM usage**: `brv query` and `brv curate` send context to a configured LLM provider for processing. The LLM sees the query or curate text and any included file contents. No data is sent to ByteRover servers unless you explicitly run `brv push`.

**Cloud sync**: `brv push` and `brv pull` require authentication (`brv login`) and send knowledge to ByteRover's cloud service. All other commands operate without ByteRover authentication.

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
