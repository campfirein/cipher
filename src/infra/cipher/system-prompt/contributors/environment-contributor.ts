import type {ContributorContext, SystemPromptContributor} from '../../../../core/domain/cipher/system-prompt/types.js'

/**
 * Environment contributor that provides environment context.
 *
 * Formats the environment context (working directory, git status,
 * platform info, file tree, etc.) for inclusion in the system prompt.
 */
export class EnvironmentContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number

  /**
   * Creates a new environment contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   */
  public constructor(id: string, priority: number) {
    this.id = id
    this.priority = priority
  }

  /**
   * Formats and returns the environment context.
   *
   * @param context - Contributor context with environment context
   * @returns Formatted environment context string, or empty string if not available
   */
  public async getContent(context: ContributorContext): Promise<string> {
    if (!context.environmentContext) {
      return ''
    }

    const env = context.environmentContext
    const dateOptions: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      weekday: 'short',
      year: 'numeric',
    }
    const formattedDate = new Date().toLocaleDateString('en-US', dateOptions)

    let result = '<env>\n'
    result += `  Working directory: ${env.workingDirectory}\n`
    result += `  Is directory a git repo: ${env.isGitRepository ? 'Yes' : 'No'}\n`
    result += `  Platform: ${env.platform}\n`
    result += `  OS Version: ${env.osVersion}\n`
    result += `  Node Version: ${env.nodeVersion}\n`
    result += `  Today's date: ${formattedDate}\n`
    result += '</env>'

    if (env.fileTree) {
      result += '\n\n' + env.fileTree
    }

    if (env.brvStructure) {
      result += '\n\n' + env.brvStructure
    }

    return result
  }
}
