# @brv/channel-skill

Agent-Skills `SKILL.md` teaching host agents (Claude Code, Codex, kimi-cli, opencode, Pi) **when** and **how** to use brv channel via the `@brv/channel-mcp` tools.

The MCP server exposes the *capability*; this skill teaches the *judgment* — when calling `channel.mention` is appropriate, when it's not, what error codes mean, and the red flags that should stop a host agent from misapplying it.

## Install

```bash
node packages/channel-skill/bin/install.js
```

The default install writes the same `SKILL.md` to **three** paths, which between them cover all five Phase-8 hosts:

| Path | Hosts that read it |
|---|---|
| `~/.claude/skills/brv-channel/SKILL.md` | Claude Code (native); kimi-cli + opencode via cross-brand fallback |
| `~/.codex/skills/brv-channel/SKILL.md` | Codex CLI (no fallback — needs its own path) |
| `~/.agents/skills/brv-channel/SKILL.md` | Pi (cross-brand fallback); kimi-cli additional fallback |

Restart each host after install so the skill is picked up at startup.

## Flags

```bash
brv-channel-skill install [options]

  --target <host>   claude | codex | kimi | opencode | pi | all   (default 'all')
  --path <abs>      override target with an explicit absolute path
  --force           overwrite an existing SKILL.md that differs
  --dry-run         print planned writes without touching disk
  --help            show help
```

`--target kimi` and `--target opencode` map onto `~/.claude/skills/` since those hosts read it via cross-brand fallback. Pass `--path` for hosts whose discovery dir doesn't fit the canonical three (e.g. a project-local `.claude/skills/<repo>`).

Idempotent: re-running with no changes prints `= unchanged <path>`. Differing content errors out unless `--force` is supplied — this protects manual edits.

## Wiring the MCP server

The skill *describes* the tools but doesn't install them. Each host needs `@brv/channel-mcp` registered in its own MCP config:

**Claude Code** (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "brv-channel": {
      "command": "node",
      "args": ["/abs/path/to/byterover-cli/packages/channel-mcp/dist/server.js"]
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[[mcp.servers]]
name = "brv-channel"
type = "stdio"
command = "node"
args = ["/abs/path/to/byterover-cli/packages/channel-mcp/dist/server.js"]
startup_timeout_sec = 10
tool_timeout_sec = 120
```

**kimi-cli, opencode, Pi** — see each host's MCP runtime docs. The bundle is the same; only the config-file format differs.

## What the skill says (summary)

- **Use brv channel for heterogeneous multi-agent collab** (kimi reviewing what Claude Code wrote, etc.). For Claude-Code-to-Claude-Code use **agent teams** instead.
- **Always sync mode + suppressThoughts=true** for routine calls; only flip `suppressThoughts: false` to debug.
- **Don't silently create channels or invite members** — those are human ops; ask the user.
- **Don't call `channel.mention` to get an answer you could give** — the user asked for a peer's opinion.

Full body: [SKILL.md](./SKILL.md). ~120 lines, structured: principle → when-to-use → steps → red flags → quick-ref → common misapplications.

## Status

Slice 8.2 of the channel-protocol implementation. See `plan/channel-protocol/IMPLEMENTATION_PHASE_8.md` §8.2.
