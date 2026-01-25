import type {SystemPromptContext} from '../types/system-prompt/types.js'

/**
 * Interface for system prompt contributors.
 * Contributors are responsible for generating parts of the system prompt
 * that will be sent to the LLM. Each contributor has a priority that
 * determines the order in which its content appears in the final prompt.
 */
export interface ISystemPromptContributor {
  /**
   * Generate the content for this contributor.
   * @param context - Runtime context containing dependencies and configuration
   * @returns The generated content string
   */
  getContent(context: SystemPromptContext): Promise<string>

  /**
   * Unique identifier for this contributor
   */
  id: string

  /**
   * Priority for ordering contributors. Lower numbers = higher priority.
   * Contributors are executed in priority order, and their content is
   * concatenated in that order.
   */
  priority: number
}