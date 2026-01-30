# ByteRover Troubleshooting

## Quick Diagnosis

```bash
brv status
```

## User Action Required

These errors require user intervention (agent cannot fix):

| Error | User Action |
|-------|-------------|
| "No ByteRover instance is running" | Start `brv` in separate terminal |
| "Not authenticated" | Run `/login` in brv REPL |
| "Project not initialized" | Run `/init` in brv REPL |
| "Connection failed" | Restart `brv` (Ctrl+C, then `brv`) |

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

ByteRover uses client-server architecture:
- User runs `brv` to start server (interactive REPL)
- Agent commands (`query`, `curate`, `status`) connect to server
- Server must be running for commands to work

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Connection error |

## Getting Help

- Email: support@byterover.dev
- Discord: https://discord.com/invite/UMRrpNjh5W
