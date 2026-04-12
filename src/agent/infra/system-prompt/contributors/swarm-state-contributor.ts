import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'
import type {ISwarmCoordinator} from '../../../core/interfaces/i-swarm-coordinator.js'

/**
 * System prompt contributor that injects swarm state information.
 *
 * Only contributes when more than 1 provider is registered,
 * since a single provider (ByteRover) doesn't need swarm awareness.
 */
export class SwarmStateContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly coordinator: ISwarmCoordinator

  constructor(id: string, priority: number, coordinator: ISwarmCoordinator) {
    this.id = id
    this.priority = priority
    this.coordinator = coordinator
  }

  public async getContent(_context: ContributorContext): Promise<string> {
    const providers = this.coordinator.getActiveProviders()

    // No swarm awareness needed with 0 or 1 provider
    if (providers.length <= 1) {
      return ''
    }

    const lines: string[] = [
      '<swarm-state>',
      '## Memory Swarm',
      '',
      `${providers.length} memory providers are active. Use the \`swarm_query\` tool to search across all of them.`,
      '',
      '### Active Providers',
    ]

    for (const p of providers) {
      const status = p.healthy ? 'healthy' : 'unhealthy'
      const caps: string[] = []
      if (p.capabilities.keywordSearch) caps.push('keyword')
      if (p.capabilities.semanticSearch) caps.push('semantic')
      if (p.capabilities.graphTraversal) caps.push('graph')
      if (p.capabilities.temporalQuery) caps.push('temporal')
      if (p.capabilities.userModeling) caps.push('user-modeling')

      lines.push(`- **${p.id}** (${p.type}) — ${status} — capabilities: ${caps.join(', ')}`)
    }

    // Write guidance — only show if writable providers exist
    const writableProviders = providers.filter((p) => p.capabilities.writeSupported && p.healthy)
    if (writableProviders.length > 0) {
      lines.push(
        '',
        '### Writing Knowledge',
        'Use `swarm_store` to write to external providers:',
      )
      for (const p of writableProviders) {
        if (p.type === 'gbrain') {
          lines.push(`- **${p.id}**: structured entities (people, companies, concepts)`)
        } else if (p.type === 'local-markdown') {
          lines.push(`- **${p.id}**: notes, drafts, meeting summaries`)
        } else {
          lines.push(`- **${p.id}**: general knowledge`)
        }
      }

      lines.push('Use `curate` for project-specific knowledge (writes to context tree).')
    }

    lines.push('', '</swarm-state>')

    return lines.join('\n')
  }
}
