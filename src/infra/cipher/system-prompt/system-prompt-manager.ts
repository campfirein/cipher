import type {
  ContributorConfig,
  SystemPromptConfig,
  SystemPromptContext,
} from '../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../core/interfaces/cipher/i-system-prompt-contributor.js'
import type {MemoryManager} from '../memory/memory-manager.js'

import {PromptRenderer} from '../resources/prompt-renderer.js'
import {PromptResourceLoader} from '../resources/prompt-resource-loader.js'
import {DateTimeContributor} from './contributors/date-time-contributor.js'
import {ExecutionModeContributor} from './contributors/execution-mode-contributor.js'
import {MarkerPromptContributor} from './contributors/marker-prompt-contributor.js'
import {MemoryContributor} from './contributors/memory-contributor.js'
import {StaticContributor} from './contributors/static-contributor.js'

/**
 * Manages system prompt contributors and builds the final system prompt.
 * The manager:
 * 1. Filters enabled contributors
 * 2. Instantiates them using a factory pattern
 * 3. Orders them by priority
 * 4. Executes them in parallel
 * 5. Concatenates results in priority order
 */
export class SystemPromptManager {
  private readonly contributors: ISystemPromptContributor[]
  private readonly memoryManager?: MemoryManager
  private readonly promptRenderer: PromptRenderer
  private readonly promptResourceLoader: PromptResourceLoader

  /**
   * Creates a new system prompt manager
   * @param config - Configuration specifying which contributors to enable
   * @param memoryManager - Optional memory manager for memory contributor (follows dexto pattern)
   * @param promptResourceLoader - Optional resource loader for YAML prompts (creates default if not provided)
   * @param promptRenderer - Optional renderer for YAML prompts (creates default if not provided)
   */
  public constructor(
    config: SystemPromptConfig,
    memoryManager?: MemoryManager,
    promptResourceLoader?: PromptResourceLoader,
    promptRenderer?: PromptRenderer,
  ) {
    this.memoryManager = memoryManager
    this.promptResourceLoader = promptResourceLoader ?? new PromptResourceLoader()
    this.promptRenderer = promptRenderer ?? new PromptRenderer()

    // Filter out disabled contributors
    const enabledContributors = config.contributors.filter((c) => c.enabled !== false)

    // Create contributor instances and sort by priority
    this.contributors = enabledContributors
      .map((config) => this.createContributor(config))
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Builds the final system prompt by executing all contributors.
   * Contributors are executed in parallel but their results are
   * concatenated in priority order.
   *
   * @param context - Runtime context to pass to contributors
   * @returns The complete system prompt string
   */
  public async build(context: SystemPromptContext = {}): Promise<string> {
    const parts = await Promise.all(
      this.contributors.map(async (contributor) => {
        const content = await contributor.getContent(context)
        return content
      }),
    )

    return parts.join('\n')
  }

  /**
   * Factory method to create contributor instances from configuration.
   * Uses discriminated union type to ensure type safety.
   *
   * @param config - Contributor configuration
   * @returns Instantiated contributor
   * @throws Error if contributor type is unknown or dependencies are missing
   */
  private createContributor(config: ContributorConfig): ISystemPromptContributor {
    switch (config.type) {
      case 'dateTime': {
        return new DateTimeContributor(config.id, config.priority, this.promptResourceLoader, this.promptRenderer)
      }

      case 'executionMode': {
        return new ExecutionModeContributor(config.id, config.priority, this.promptResourceLoader, this.promptRenderer)
      }

      case 'markerPrompt': {
        return new MarkerPromptContributor(config.id, config.priority, this.promptResourceLoader, this.promptRenderer)
      }

      case 'memory': {
        if (!this.memoryManager) {
          throw new Error(
            'Memory contributor requires MemoryManager to be provided in SystemPromptManager constructor',
          )
        }

        return new MemoryContributor(config.id, config.priority, {
          memoryManager: this.memoryManager,
          renderer: this.promptRenderer,
          resourceLoader: this.promptResourceLoader,
        }, config.options)
      }

      case 'static': {
        return new StaticContributor(
          config.id,
          config.priority,
          this.promptResourceLoader,
          this.promptRenderer,
          config.content, // Optional custom content for backward compatibility
          config.category, // Optional category for YAML file
          config.filename, // Optional filename for YAML file
        )
      }

      default: {
        throw new Error(`Unknown contributor type: ${(config as ContributorConfig).type}`)
      }
    }
  }
}
