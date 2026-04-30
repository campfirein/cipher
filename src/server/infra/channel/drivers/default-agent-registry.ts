import type {AgentEntry} from '../../../core/domain/channel/types.js'

/**
 * Pinned supported version of the Claude Code ACP adapter
 * (`@anthropic-ai/claude-code-acp`). Surfaced in `AgentNotInstalledError`'s
 * remediation hint so users see an exact `npm install -g` command rather than
 * `@latest`. Phase 4 doctor automates this install after consent.
 */
export const SUPPORTED_CLAUDE_CODE_ACP_VERSION = '0.4.0'

/**
 * Pinned supported version of the OpenCode CLI's `acp` mode. OpenCode itself
 * is the binary; the `acp` subcommand toggles ACP-stdio mode. Version drift
 * detection is advisory in v1.
 */
export const SUPPORTED_OPENCODE_VERSION = '0.5.0'

const ENTRIES: AgentEntry[] = [
  {
    displayName: 'Claude Code',
    id: 'claude-code',
    // F1 review fix — bare command on PATH; never `npx -y …@latest`. Phase 4 doctor handles install.
    launch: {args: [], command: 'claude-code-acp', kind: 'stdio'},
    role: 'coding-agent',
  },
  {
    displayName: 'OpenCode',
    id: 'opencode',
    launch: {args: ['acp'], command: 'opencode', kind: 'stdio'},
    role: 'coding-agent',
  },
]

/**
 * Built-in (Phase 2) agent registry. Phase 4's bundle-plugin loader
 * (`~/.brv/channel-agents.json`) wraps this with a merged view; the wrapper
 * has the same `get`/`list` shape so call sites don't change.
 */
export class DefaultAgentRegistry {
  private readonly byId: Map<string, AgentEntry>

  public constructor(extra: AgentEntry[] = []) {
    this.byId = new Map([...ENTRIES, ...extra].map((entry) => [entry.id, entry]))
  }

  public get(agentId: string): AgentEntry | undefined {
    return this.byId.get(agentId)
  }

  public list(): AgentEntry[] {
    return [...this.byId.values()]
  }
}
