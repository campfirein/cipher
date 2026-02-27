# ByteRover Troubleshooting

> **Authentication is NOT required for local usage.** `brv query`, `brv curate`, and `brv status` all work without login. Only cloud sync commands (`push`, `pull`, `space`) require authentication — skip them if not needed.

## Quick Diagnosis

```bash
brv status
```

## User Action Required

These errors require user intervention (agent cannot fix):

| Error | User Action |
|-------|-------------|
| "No provider connected" | Run `brv providers connect byterover` in a terminal |
| "Daemon failed to start" | Run `brv restart` to force a clean restart |
| "Connection failed" | Retry the command |

**Template response:**
> Please [action] in your brv terminal, then I'll retry the command.

## Agent-Fixable Errors

| Error | Fix |
|-------|-----|
| "Context argument required" | Add text before `-f`: `brv curate "text" -f file` |
| "Maximum 5 files allowed" | Reduce to 5 or fewer `-f` flags |
| "File not found" | Verify path with `ls`, use relative paths from project root |
| "No relevant context found" | Try different query phrasing, or curate knowledge first |

## Architecture

ByteRover runs a daemon in the background:
- Commands (`query`, `curate`, `status`) auto-start the daemon on first run
- No manual setup required — the daemon starts automatically

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Connection error |

## Cloud Features (optional)

`push`, `pull`, and `space` commands require authentication. These are not needed for local
context tree usage (`query`, `curate`, `status`). To use cloud sync: run `brv login --help`
for setup instructions.

## Getting Help

- Email: support@byterover.dev
- Discord: https://discord.com/invite/UMRrpNjh5W
