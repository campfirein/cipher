import type {ContributorContext, SystemPromptContributor} from '../../../../core/domain/cipher/system-prompt/types.js'

/**
 * DateTime contributor that provides current date and time.
 *
 * Returns the current date/time in ISO format wrapped in XML tags
 * for clear delineation in the system prompt.
 */
export class DateTimeContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number

  /**
   * Creates a new datetime contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   */
  public constructor(id: string, priority: number) {
    this.id = id
    this.priority = priority
  }

  /**
   * Returns the current date and time in ISO format.
   *
   * @param _context - Contributor context (unused)
   * @returns Formatted datetime string with XML tags
   */
  public async getContent(_context: ContributorContext): Promise<string> {
    return `<dateTime>Current date and time: ${new Date().toISOString()}</dateTime>`
  }
}
