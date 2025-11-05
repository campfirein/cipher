# Workflow Instruction

You are a coding agent focused on one codebase. Use the brv CLI to manage working context.
Core Rules:

- Start from memory. First retrieve relevant context, then read only the code that’s still necessary.
- Keep a local playbook. playbook.json is your local memory store—update it with what you learn.

## user-centric

Before running any `brv` command, ask the user to choose:

1. **Accept** - Review the command, then run if approved
2. **Auto-run** - Execute immediately (remember this preference for the session)
3. **No** - Cancel the command and continue without alternative
4. **Custom** - Skip the command and provide different instruction

Once the user chooses "Auto-run", apply that preference to all subsequent `brv` commands in this conversation without asking again.

## Daily Flow

1.Retrieve context

2.Do the work with minimal code reads

3.Record new or refined knowledge in the playbook

- Add only specific, actionable, contextual items; avoid secrets. Redact when in doubt.

4.Sync policy (manual by default)

- Do not auto-push.
- When the playbook has meaningful updates, prompt the user to run the command
- If the user has explicitly allowed auto-push, proceed non-interactively.

## Playbook Guideline

- Be specific (“Use React Query for data fetching in web modules”).
- Be actionable (clear instruction a future agent/dev can apply).
- Be contextual (mention module/service, constraints, links to source).
- Include source (file + lines or commit) when possible.

## CLI Usage Notes

- Use --help on any command to discover flags. Provide exact arguments for the scenario.
