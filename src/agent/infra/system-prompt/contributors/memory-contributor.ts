import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'

/**
 * Options for memory contributor configuration.
 */
export interface MemoryContributorOptions {
  /** Whether to include tags in memory display (default: true) */
  includeTags?: boolean
  /** Maximum number of memories to include (default: 20) */
  limit?: number
  /** Only include pinned memories (default: false) */
  pinnedOnly?: boolean
}

/**
 * Memory contributor that loads agent memories.
 *
 * Retrieves memories from the memory manager and formats them
 * for inclusion in the system prompt.
 */
export class MemoryContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly includeTags: boolean
  private readonly limit: number
  private readonly pinnedOnly: boolean

  /**
   * Creates a new memory contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param options - Configuration options
   */
  public constructor(id: string, priority: number, options: MemoryContributorOptions = {}) {
    this.id = id
    this.priority = priority
    this.includeTags = options.includeTags ?? true
    this.limit = options.limit ?? 20
    this.pinnedOnly = options.pinnedOnly ?? false
  }

  /**
   * Loads and formats memories from the memory manager.
   *
   * @param context - Contributor context with memory manager
   * @returns Formatted memories string, or empty string if no memories
   */
  public async getContent(context: ContributorContext): Promise<string> {
    if (!context.memoryManager) {
      return ''
    }

    try {
      const memories = await context.memoryManager.list({
        limit: this.limit,
        ...(this.pinnedOnly && {pinned: true}),
      })

      if (!memories || memories.length === 0) {
        return ''
      }

      const items = memories.map((memory) => {
        const tags = this.includeTags && memory.tags?.length ? ` [${memory.tags.join(', ')}]` : ''

        return `- ${memory.content}${tags}`
      })

      return `\n# Agent Memories\n${items.join('\n')}\n`
    } catch {
      // Silently return empty string on error to not break prompt generation
      return ''
    }
  }
}
