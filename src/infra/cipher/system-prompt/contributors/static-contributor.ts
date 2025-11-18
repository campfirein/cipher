import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

/**
 * Static system prompt contributor that returns the base system prompt.
 *
 * Supports three modes:
 * 1. **Custom mode**: Uses provided custom content (highest priority, backward compatibility)
 * 2. **Specific YAML mode**: Loads a specific YAML file from category/filename
 * 3. **Default YAML mode**: Loads cipher-agent.yml (default behavior)
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
   * @param category - Optional category for YAML file (e.g., 'base', 'contributors')
   * @param filename - Optional filename for YAML file (without .yml extension)
   */
  // eslint-disable-next-line max-params
  public constructor(
    public readonly id: string,
    public readonly priority: number,
    private readonly resourceLoader: PromptResourceLoader,
    private readonly renderer: PromptRenderer,
    private readonly customContent?: string,
    private readonly category?: string,
    private readonly filename?: string,
  ) {}

  /**
   * Returns the static content.
   *
   * Priority:
   * 1. Custom content (if provided) - for backward compatibility
   * 2. Specific YAML file (if category and filename provided)
   * 3. Base prompt YAML (cipher-agent.yml) - default behavior
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
    const prompt = this.category && this.filename
      ? await this.resourceLoader.loadPrompt(this.category, this.filename)
      : await this.resourceLoader.loadBasePrompt()

    // Validate that prompt has sections property
    if (!('sections' in prompt) || typeof prompt.sections !== 'object' || prompt.sections === null) {
      const source = this.category && this.filename
        ? `${this.category}/${this.filename}`
        : 'base prompt (cipher-agent.yml)'
      throw new Error(`Invalid prompt structure: expected sections in ${source}`)
    }

    this.cachedContent = this.renderer.renderBasePrompt(prompt.sections)

    return this.cachedContent
  }
}
