import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

/**
 * Static system prompt contributor that returns the base system prompt.
 *
 * Supports two modes:
 * 1. **YAML mode** (default): Loads cipher-agent.yml and renders it
 * 2. **Custom mode**: Uses provided custom content (backward compatibility)
 */
export class StaticContributor implements ISystemPromptContributor {
  private cachedContent: null | string = null

  /**
   * Creates a new static contributor
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Priority for ordering (lower = higher priority)
   * @param resourceLoader - Loader for YAML resources
   * @param renderer - Renderer for converting YAML to text
   * @param customContent - Optional custom content (overrides YAML)
   */
  // eslint-disable-next-line max-params
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly resourceLoader: PromptResourceLoader,
    private readonly renderer: PromptRenderer,
    private readonly customContent?: string,
  ) {}

  /**
   * Returns the static content.
   *
   * Priority:
   * 1. Custom content (if provided) - for backward compatibility
   * 2. YAML content (cipher-agent.yml) - default behavior
   *
   * @param _context - Runtime context (unused for static contributors)
   * @returns The static content string
   */
  public async getContent(_context: SystemPromptContext): Promise<string> {
    // Use custom content if provided (backward compatibility)
    // Check for undefined explicitly to allow empty strings
    if (this.customContent !== undefined) {
      return this.customContent
    }

    // Use cached content if available
    if (this.cachedContent) {
      return this.cachedContent
    }

    // Load and render from YAML
    const basePrompt = await this.resourceLoader.loadBasePrompt()
    this.cachedContent = this.renderer.renderBasePrompt(basePrompt.sections)

    return this.cachedContent
  }
}
