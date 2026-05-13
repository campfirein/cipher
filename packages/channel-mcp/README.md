# @brv/channel-mcp

MCP server exposing brv channel-protocol tools over stdio. Drop the bundled `dist/server.js` into any MCP-capable host (Claude Code, Codex, kimi-cli, opencode, Pi) to give the host agent-driven access to brv channels.

## Tools

| Tool | Use case |
|---|---|
| `channel.list` | List channels visible from the current project. |
| `channel.mention` | Mention agent members and block until the turn completes; returns the assembled answer. Always sync mode. `suppressThoughts` defaults to `true`. |
| `channel.show` | Read the full transcript of a single turn. |
| `channel.doctor` | Probe registered agent driver profiles. |

`channel.create`, `channel.invite`, and `channel.permission-decision` are deliberately **not exposed** — these are operator/human surfaces. Ask the user to run `brv channel ...` in a terminal for those.

## Install

Phase 8 ships local-install. Build from the workspace:

```bash
npm run build:channel-mcp
```

That produces `packages/channel-mcp/dist/server.js`. Host configs point at the absolute path.

## Host configs

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

**kimi-cli, opencode, Pi** — host-specific MCP runtime configs; the bundle is the same.

## Prereq

A running `brv` daemon. Run any `brv` command once (e.g. `brv channel list`) to boot it. The MCP server fails fast with `BRV_DAEMON_NOT_INITIALISED` if the daemon hasn't been started.

## Status

Slice 8.1 of the channel-protocol implementation. Built on `@brv/channel-client`. Plan: `plan/channel-protocol/IMPLEMENTATION_PHASE_8.md` §8.1.
