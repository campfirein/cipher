---
name: byterover
description: "Knowledge management for AI agents. Use `brv` to store and retrieve project patterns, decisions, and architectural rules in .brv/context-tree. Uses a configured LLM provider (default: ByteRover, no API key needed) for query and curate operations."
metadata: {"moltbot":{"emoji":"🧠","requires":{"bins":["brv"]},"install":[{"id":"npm","kind":"node","package":"byterover-cli","bins":["brv"],"label":"Install ByteRover CLI (npm)"}]}}
---

# ByteRover Knowledge Management

Use the `brv` CLI to manage your project's long-term memory.
Install: `npm install -g byterover-cli`
Knowledge is stored in `.brv/context-tree/` as human-readable Markdown files.

## Workflow

1.  **Before Thinking:** Run `brv query` to understand existing patterns.
2.  **After Implementing:** Run `brv curate` to save new patterns/decisions.

## Commands

### 1. Query Knowledge
Retrieve relevant context from your project's knowledge base.
Uses a configured LLM provider to synthesize answers from `.brv/context-tree/` content.

```bash
brv query "How is authentication implemented?"
```

### 2. Curate Context
Analyze and save knowledge to the local knowledge base.
Uses a configured LLM provider to categorize and structure the context you provide.

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
brv provider connect anthropic --api-key sk-xxx
```

### 4. Cloud Sync (Optional)
**Only** if the user has explicitly logged in (`brv login`) to share knowledge with a team:

```bash
# Pull team updates
brv pull

# Push local changes
brv push -y
```

## Data Handling

**Storage**: All knowledge is stored as Markdown files in `.brv/context-tree/` within the project directory. Files are human-readable and version-controllable.

**File access**: The `-f` flag on `brv curate` reads files from the current project directory only. Paths outside the project root are rejected. Maximum 5 files per command, text and document formats only.

**LLM usage**: `brv query` and `brv curate` send context to a configured LLM provider for processing. The LLM sees the query/curate text and any included file contents. No data is sent to ByteRover servers unless you explicitly run `brv push`.

**Cloud sync**: `brv push` and `brv pull` require authentication (`brv login`) and send knowledge to ByteRover's cloud service. All other commands operate without ByteRover authentication.

## Error Handling
- **"Not authenticated"**: You are trying to `push` or `pull`. These require `brv login`. Use `brv query` or `brv curate` instead; they do not require ByteRover authentication (but do require a configured LLM provider).
