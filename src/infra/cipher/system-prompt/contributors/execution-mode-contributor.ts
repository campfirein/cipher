import type {SystemPromptContext} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {PromptRenderer} from '../../resources/prompt-renderer.js'
import type {PromptResourceLoader} from '../../resources/prompt-resource-loader.js'

/**
 * Execution Mode Contributor
 *
 * Provides context-specific instructions based on the execution mode.
 * Loads execution mode content from YAML and renders it based on runtime context.
 */
export class ExecutionModeContributor implements ISystemPromptContributor {
  /**
   * Creates a new execution mode contributor
   *
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
   * Get system prompt content based on execution context
   *
   * @param context - System prompt context containing execution mode information
   * @returns Execution mode-specific instructions or empty string
   */
  public async getContent(context: SystemPromptContext): Promise<string> {
    // Only render if in JSON input mode
    if (context.isJsonInputMode !== true) {
      return ''
    }

    // Load execution modes from YAML
    const executionModes = await this.resourceLoader.loadExecutionModes()

    // Render execution mode sections
    return this.renderer.renderExecutionModes(executionModes.modes, {
      conversationId: context.conversationMetadata?.conversationId,
      conversationTitle: context.conversationMetadata?.title,
      isJsonInputMode: context.isJsonInputMode,
    })
  }
}
