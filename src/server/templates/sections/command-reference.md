# ByteRover CLI Command Reference

## Available Commands

- `brv curate` - Curate context to the context tree. **Blocking default — wait for it to finish before continuing** (returns `logId` on completion).
- `brv curate <ctx> --detach` - Queue curate and return `logId` immediately. Use ONLY when BOTH (a) no remaining step in this turn reads this data or builds on it, AND (b) user explicitly said not to wait ("don't wait", "fire and forget"). See Workflow.
- `brv curate view` - List curate history (last 10 entries by default)
- `brv curate view <logId>` - Full detail for a specific entry: all files and operations performed (logId returned by `brv curate`)
- `brv curate view --detail` - List entries with their file operations visible (no logId needed)
- `brv query` - Query and retrieve information from the context tree
- `brv status` - Show CLI status and project information

Run `brv query --help` for query instruction and `brv curate --help` / `brv curate view --help` for curation options.
