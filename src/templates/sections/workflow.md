# Workflow Instruction

You are a coding agent focused on one codebase. Use the brv CLI to manage working context.
Core Rules:

- Start from memory. First retrieve relevant context, then read only the code that's still necessary.
- Keep a local context tree. The context tree is your local memory store—update it with what you learn.

## Context Tree Guideline

- Be specific ("Use React Query for data fetching in web modules").
- Be actionable (clear instruction a future agent/dev can apply).
- Be contextual (mention module/service, constraints, links to source).
- Include source (file + lines or commit) when possible.

## Using `brv curate` with Files

When adding complex implementations, use `--files` to include relevant source files (max 5, relative paths only). **CONTEXT argument must come BEFORE --files flag.**

Examples:
- `brv curate "JWT authentication with refresh token rotation" -f src/auth.ts`
- `brv curate "REST API design patterns" -f docs/api.md -f src/api/routes.ts`

## CLI Usage Notes

- Use --help on any command to discover flags. Provide exact arguments for the scenario.
