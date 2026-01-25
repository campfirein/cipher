import type {ContributorContext, SystemPromptContributor} from '../../types/system-prompt/types.js'

/**
 * Static contributor that returns inline content.
 *
 * Use this for fixed prompt content that doesn't change at runtime.
 */
export class StaticContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly content: string

  /**
   * Creates a new static contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param content - Static content to return
   */
  public constructor(id: string, priority: number, content: string) {
    this.id = id
    this.priority = priority
    this.content = content
  }

  /**
   * Returns the static content.
   *
   * @param _context - Contributor context (unused)
   * @returns Static content string
   */
  public async getContent(_context: ContributorContext): Promise<string> {
    return this.content
  }
}
