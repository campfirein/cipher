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

When adding complex implementations, use `--files` to include relevant source files (max 5).  Only text/code files from the current project directory are allowed. **CONTEXT argument must come BEFORE --files flag.** For multiple files, repeat the `--files` (or `-f`) flag for each file.

Examples:

- Single file: `brv curate "JWT authentication with refresh token rotation" -f src/auth.ts`
- Multiple files: `brv curate "Authentication system" --files src/auth/jwt.ts --files src/auth/middleware.ts --files docs/auth.md`

## CLI Usage Notes

- Use --help on any command to discover flags. Provide exact arguments for the scenario.
