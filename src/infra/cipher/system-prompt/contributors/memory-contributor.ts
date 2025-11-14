import type {
  MemoryContributorOptions,
  SystemPromptContext,
} from '../../../../core/domain/cipher/system-prompt/types.js';
import type { ISystemPromptContributor } from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js';
import type { MemoryManager } from '../../memory/memory-manager.js';

/**
 * Memory contributor for system prompts.
 * Retrieves and formats agent memories for inclusion in the system prompt.
 *
 * Follows the pattern from dexto's MemoryContributor:
 * - Fetches memories on every build() call (no caching)
 * - Formats as markdown bullet list
 * - Optionally includes tags and timestamps
 * - Returns empty string on error or no memories (graceful degradation)
 */
export class MemoryContributor implements ISystemPromptContributor {
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly memoryManager: MemoryManager,
    private readonly options: MemoryContributorOptions = {},
  ) {
    console.log(
      `MemoryContributor created: "${id}" with options: ${JSON.stringify(options)}`,
    );
  }

  /**
   * Get formatted memory content for the system prompt
   * @param _context - System prompt context (currently unused)
   * @returns Formatted memory content or empty string
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    const {
      includeTags = true,
      includeTimestamps = false,
      limit,
      pinnedOnly = false,
      source,
    } = this.options;

    try {
      // Fetch memories with filters
      const memories = await this.memoryManager.list({
        ...(limit !== undefined && { limit }),
        ...(pinnedOnly && { pinned: true }),
        ...(source && { source }),
      });

      // Return empty string if no memories (graceful degradation)
      if (memories.length === 0) {
        return '';
      }

      // Format memories as bullet list
      const formattedMemories = memories.map((memory) => {
        let formatted = `- ${memory.content}`;

        // Add tags if enabled and present
        if (includeTags && memory.tags && memory.tags.length > 0) {
          formatted += ` [Tags: ${memory.tags.join(', ')}]`;
        }

        // Add timestamp if enabled
        if (includeTimestamps) {
          const date = new Date(memory.updatedAt).toLocaleDateString();
          formatted += ` (Updated: ${date})`;
        }

        return formatted;
      });

      // Build final output with header
      const header = '## Agent Memories';
      const memoryList = formattedMemories.join('\n');

      return `${header}\n${memoryList}`;
    } catch (error) {
      // Log error but don't break system prompt generation
      console.error(
        `[MemoryContributor] Failed to load memories: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Graceful degradation: return empty string
      return '';
    }
  }
}
