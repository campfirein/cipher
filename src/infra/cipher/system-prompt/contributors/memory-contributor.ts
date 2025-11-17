import type {MemoryContributorOptions, SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {MemoryManager} from '../../memory/memory-manager.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

/**
 * Dependencies for MemoryContributor
 */
export interface MemoryContributorDependencies {
  memoryManager: MemoryManager
  renderer: PromptRenderer
  resourceLoader: PromptResourceLoader
}

/**
 * Memory contributor for system prompts.
 * Retrieves and formats agent memories for inclusion in the system prompt.
 *
 * Follows the pattern from dexto's MemoryContributor:
 * - Fetches memories on every build() call (no caching)
 * - Formats using YAML templates
 * - Optionally includes tags and timestamps
 * - Returns empty string on error or no memories (graceful degradation)
 */
export class MemoryContributor implements ISystemPromptContributor {
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly dependencies: MemoryContributorDependencies,
    private readonly options: MemoryContributorOptions = {},
  ) {
    console.log(`MemoryContributor created: "${id}" with options: ${JSON.stringify(options)}`)
  }

  /**
   * Get formatted memory content for the system prompt
   * @param _context - System prompt context (currently unused)
   * @returns Formatted memory content or empty string
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    const {includeTags = true, includeTimestamps = false, limit, pinnedOnly = false, source} = this.options

    try {
      // Load memory formatting from YAML
      const memoryYaml = await this.dependencies.resourceLoader.loadMemory()

      // Fetch memories with filters
      const memories = await this.dependencies.memoryManager.list({
        ...(limit !== undefined && {limit}),
        ...(pinnedOnly && {pinned: true}),
        ...(source && {source}),
      })

      // Return empty string if no memories (graceful degradation)
      if (memories.length === 0) {
        return memoryYaml.formatting.emptyMessage
      }

      // Format memories using YAML templates
      const formattedMemories = memories.map((memory) => {
        const hasTags = memory.tags && memory.tags.length > 0
        const tags = hasTags ? memory.tags!.join(', ') : ''
        const updatedAt = new Date(memory.updatedAt).toLocaleDateString()

        // Choose template based on what's included
        let template: string
        if (includeTags && hasTags && includeTimestamps) {
          template = memoryYaml.formatting.itemWithBothTemplate
        } else if (includeTags && hasTags) {
          template = memoryYaml.formatting.itemWithTagsTemplate
        } else if (includeTimestamps) {
          template = memoryYaml.formatting.itemWithTimestampTemplate
        } else {
          template = memoryYaml.formatting.itemTemplate
        }

        // Render template with variables
        return this.dependencies.renderer.render(template, {
          content: memory.content,
          tags,
          updatedAt,
        })
      })

      // Build final output with header
      const memoryList = formattedMemories.join('\n')

      return `${memoryYaml.formatting.header}\n${memoryList}`
    } catch (error) {
      // Log error but don't break system prompt generation
      console.error(
        `[MemoryContributor] Failed to load memories: ${error instanceof Error ? error.message : String(error)}`,
      )

      // Graceful degradation: return empty string
      return ''
    }
  }
}
