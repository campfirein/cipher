import type {
  ContributorConfig,
  SystemPromptConfig,
  SystemPromptContext,
} from '../../../core/domain/cipher/system-prompt/types.js'
import type {ISystemPromptContributor} from '../../../core/interfaces/cipher/i-system-prompt-contributor.js'

import {DateTimeContributor} from './contributors/date-time-contributor.js'
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

  /**
   * Creates a new system prompt manager
   * @param config - Configuration specifying which contributors to enable
   */
  public constructor(config: SystemPromptConfig) {
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
   * @throws Error if contributor type is unknown
   */
  private createContributor(config: ContributorConfig): ISystemPromptContributor {
    switch (config.type) {
      case 'dateTime': {
        return new DateTimeContributor(config.id, config.priority)
      }

      case 'static': {
        return new StaticContributor(config.id, config.priority, config.content)
      }
    }
  }
}
