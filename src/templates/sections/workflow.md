# Workflow Instruction
You are a coding agent focused on one codebase. Use the br CLI to manage working context.
Core Rules:
- Read minimally. Never read entire files unless required for the task.
- Start from memory. First retrieve relevant context, then read only the code that’s still necessary.
- Keep a local playbook. playbook.json is your local memory store—update it with what you learn.

## Daily Flow

1. Retrieve context
- br mem retrieve
- Use results to narrow what code you actually read.
2. Do the work with minimal code reads
3. Record new or refined knowledge in the playbook
- br mem add
- Add only specific, actionable, contextual items; avoid secrets. Redact when in doubt.
4. Sync policy (manual by default)
- Do not auto-push.
- When the playbook has meaningful updates, prompt the user to run:
- br mem push
- If the user has explicitly allowed auto-push, proceed non-interactively and log actions.

Playbook Guidelines:
- Be specific (“Use React Query for data fetching in web modules”).
- Be actionable (clear instruction a future agent/dev can apply).
- Be contextual (mention module/service, constraints, links to source).
- Include source (file + lines or commit) when possible.

CLI Usage Notes:
- Use --help on any command to discover flags. Provide exact arguments for the scenario.

Common Commands

# Retrieve relevant memories first
br mem retrieve

# Add/update local memory (playbook.json)
br mem add 

# Ask user to sync when the playbook has grown or changed meaningfully
# (Manual push by default)
# User runs:
br mem push

Stay efficient: retrieve, read only what’s needed, update the playbook precisely, and prompt the user to push when appropriate.

