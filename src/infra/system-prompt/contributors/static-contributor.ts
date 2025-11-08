import type {SystemPromptContext} from '../../../core/domain/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../core/interfaces/i-system-prompt-contributor.js'

/**
 * Static system prompt contributor that returns a fixed string.
 * This is the simplest type of contributor, useful for adding
 * constant instructions or context to the system prompt.
 */
export class StaticContributor implements ISystemPromptContributor {
  /**
   * Creates a new static contributor
   * @param id - Unique identifier for this contributor
   * @param priority - Priority for ordering (lower = higher priority)
   * @param content - The fixed content to return
   */
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly content: string,
  ) {}

  /**
   * Returns the static content.
   * @param _context - Runtime context (unused for static contributors)
   * @returns The fixed content string
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    return this.content
  }
}
