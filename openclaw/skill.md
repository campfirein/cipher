---
name: byterover
description: "You MUST use this for gathering contexts before any work. This is a Knowledge management for AI agents. Use `brv` to store and retrieve project patterns, decisions, and architectural rules in .brv/context-tree. Uses a configured LLM provider (default: ByteRover, no API key needed) for query and curate operations."
metadata: {"moltbot":{"emoji":"🧠","requires":{"bins":["brv"]},"install":[{"id":"npm","kind":"node","package":"byterover-cli","bins":["brv"],"label":"Install ByteRover CLI (npm)"}]}}
---

# ByteRover Knowledge Management

Use the `brv` CLI to manage your project's long-term memory.
Install: `npm install -g byterover-cli`
Knowledge is stored in `.brv/context-tree/` as human-readable Markdown files.

## Workflow
0.  **Important working directory:** Run `cd ~/.openclaw` before using `brv` commands to ensure they operate on the correct knowledge base.
1.  **Before Thinking:** Run `brv query` to understand existing patterns.
2.  **After Implementing:** Run `brv curate` to save new patterns/decisions.

## Commands

### 1. Query Knowledge
**Overview:** Retrieve relevant context from your project's knowledge base.
Uses a configured LLM provider to synthesize answers from `.brv/context-tree/` content.

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
**Overview**: Analyze and save knowledge to the local knowledge base, Uses a configured LLM provider to categorize and structure the context you provide.

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

### 3. LLM Provider Setup
`brv query` and `brv curate` require a configured LLM provider. Connect the default ByteRover provider (no API key needed):

```bash
brv provider connect byterover
```

To use a different provider (e.g., OpenAI, Anthropic, Google), list available options and connect with your own API key:

```bash
brv provider list
brv provider connect openai --api-key sk-xxx --model gpt-4.1
```

### 4. Cloud Sync (Optional)
Requires authentication via `brv login`. Used to share knowledge with a team:

```bash
# Pull team updates
brv pull

# Push local changes
brv push
```

## Data Handling

**Storage**: All knowledge is stored as Markdown files in `.brv/context-tree/` within the project directory. Files are human-readable and version-controllable.

**File access**: The `-f` flag on `brv curate` reads files from the current project directory only. Paths outside the project root are rejected. Maximum 5 files per command, text and document formats only.

**LLM usage**: `brv query` and `brv curate` send context to a configured LLM provider for processing. The LLM sees the query or curate text and any included file contents. No data is sent to ByteRover servers unless you explicitly run `brv push`.

**Cloud sync**: `brv push` and `brv pull` require authentication (`brv login`) and send knowledge to ByteRover's cloud service. All other commands operate without ByteRover authentication.

## Error Handling
- **"Not authenticated"**: This means `push` or `pull` was attempted. These commands require `brv login`. Use `brv query` or `brv curate` instead; they do not require ByteRover authentication (but do require a configured LLM provider).
