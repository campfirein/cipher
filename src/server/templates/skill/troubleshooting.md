---
name: byterover-troubleshooting
description: "Use when a brv command fails with an auth, connection, token, or billing error, or when you need ByteRover data-handling and file-input limits."
---

# ByteRover Troubleshooting

Use this when a `brv` command errors, so you either guide the user or fix the call and retry. Do not silently swallow ByteRover errors.

## When To Use

- A `brv` command returns an authentication, connection, token, or billing error.
- A `brv curate` call is rejected for bad arguments or unsupported files.
- You need to explain ByteRover's data-handling or `-f` file-input limits.

## Errors The User Must Resolve

You cannot fix these yourself. Show the user the exact fix instead of looping.

| Error | Tell the user |
|---|---|
| `Not authenticated` | Run `brv login` (see `brv login --help` for options). |
| `Connection failed` / `Instance crashed` | Kill the running `brv` process, then retry. |
| `Token has expired` / `Token is invalid` | Run `brv login` again to re-authenticate. |
| `Billing error` / `Rate limit exceeded` | Check account credits or wait before retrying. |

## Errors You Should Fix And Retry

Handle these yourself, then re-run the command.

| Error | Fix |
|---|---|
| `Missing required argument(s).` | Run `brv <command> --help` and supply the argument. |
| `Maximum 5 files allowed` | Reduce to 5 or fewer `-f` files per `brv curate`. |
| `File does not exist` | Verify with `ls`; use paths relative to the project root. |
| `File type not supported` | Use only text, image, PDF, or office files. |

## Data Handling

- **Storage**: knowledge is human-readable Markdown in `.brv/context-tree/`, version-controllable via `brv vc`.
- **File access**: `-f` on `brv curate` reads only inside the current project; outside paths are rejected; max 5 files, text/document formats only.
- **LLM usage**: ByteRover does NOT invoke any LLM of its own on `brv query` or `brv curate`. The calling agent's own LLM is the only model that sees query text, curate intent, or file contents. Nothing is sent to ByteRover servers unless you run `brv vc push`.
- **Cloud sync**: `brv vc push` / `brv vc pull` require `brv login`; every other command works without authentication.

## Quick Diagnosis

```bash
brv status
```

Run `brv status` to check authentication and project state before deeper debugging.

## Common Mistakes

| Mistake | Correct behavior |
|---|---|
| Silently failing on an auth error | Show the user the exact fix from the table above |
| Retrying a user-resolvable error in a loop | Stop and tell the user what to do |
| Passing more than 5 `-f` files | Trim to 5 or fewer and retry |
| Assuming local data left the machine | Local commands send nothing to ByteRover servers |
