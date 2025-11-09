import type {SystemPromptContext} from '../../../core/domain/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../core/interfaces/i-system-prompt-contributor.js'

/**
 * Dynamic contributor that provides current date and time.
 * This ensures the LLM has accurate temporal context for each request.
 */
export class DateTimeContributor implements ISystemPromptContributor {
  /**
   * Creates a new date-time contributor
   * @param id - Unique identifier for this contributor
   * @param priority - Priority for ordering (lower = higher priority)
   */
  public constructor(
    public readonly id: string,
    public readonly priority: number,
  ) {}

  /**
   * Generates a formatted date-time string wrapped in XML tags.
   * @param _context - Runtime context (unused for date-time)
   * @returns Current ISO timestamp wrapped in <dateTime> tags
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    const now = new Date().toISOString()
    return `<dateTime>Current date and time: ${now}</dateTime>`
  }
}
