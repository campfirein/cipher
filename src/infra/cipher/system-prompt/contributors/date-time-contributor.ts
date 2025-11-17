import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

/**
 * Dynamic contributor that provides current date and time.
 * This ensures the LLM has accurate temporal context for each request.
 * Loads formatting template from YAML for maintainability.
 */
export class DateTimeContributor implements ISystemPromptContributor {
  /**
   * Creates a new date-time contributor
   * @param id - Unique identifier for this contributor
   * @param priority - Priority for ordering (lower = higher priority)
   * @param resourceLoader - Loader for YAML resources
   * @param renderer - Renderer for converting YAML to text
   */
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly resourceLoader: PromptResourceLoader,
    private readonly renderer: PromptRenderer,
  ) {}

  /**
   * Generates a formatted date-time string using YAML template.
   * @param _context - Runtime context (unused for date-time)
   * @returns Current ISO timestamp formatted according to YAML template
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    // Load datetime template from YAML
    const datetimeYaml = await this.resourceLoader.loadDateTime()

    // Get current timestamp
    const now = new Date().toISOString()

    // Render template with timestamp variable
    return this.renderer.render(datetimeYaml.format.template, {
      timestamp: now,
    })
  }
}
