import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {ContributorContext, SystemPromptContributor} from '../../types/system-prompt/types.js'

import {SystemPromptError} from '../../types/errors/system-prompt-error.js'

/**
 * Internal structure for YAML files with prompts.
 */
interface PromptsYaml {
  description?: string
  prompt?: string
  prompts?: Record<string, string>
}

/**
 * Options for companion contributor configuration.
 */
export interface CompanionContributorOptions {
  /** Base path for resolving relative file paths */
  basePath?: string
}

/**
 * Companion contributor that discovers and loads companion prompts.
 *
 * Discovers files matching the pattern `{commandType}-*.yml` and
 * loads their prompt content.
 *
 * Features:
 * - Automatic discovery of companion prompts by commandType
 * - Loads and concatenates multiple companion files
 * - Graceful handling of missing files
 */
export class CompanionContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly basePath: string

  /**
   * Creates a new companion contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param options - Configuration options
   */
  public constructor(id: string, priority: number, options: CompanionContributorOptions = {}) {
    this.id = id
    this.priority = priority

    // Default to resources/prompts directory
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    this.basePath = options.basePath ?? path.join(currentDir, '../../../resources/prompts')
  }

  /**
   * Discovers and loads companion prompts based on commandType.
   *
   * @param context - Contributor context with commandType
   * @returns Concatenated companion prompt content
   */
  public async getContent(context: ContributorContext): Promise<string> {
    if (!context.commandType) {
      return ''
    }

    const companionFiles = this.discoverCompanionPrompts(context.commandType)

    if (companionFiles.length === 0) {
      return ''
    }

    const contents: string[] = []

    for (const filename of companionFiles) {
      try {
        const content = this.loadPromptFile(filename)

        if (content) {
          contents.push(content)
        }
      } catch {
        // Silently skip files that fail to load
      }
    }

    return contents.join('\n\n')
  }

  /**
   * Discover companion prompt files for a given commandType.
   * Looks for files matching the pattern: {commandType}-*.yml
   *
   * @param commandType - The command type (e.g., 'query', 'curate')
   * @returns Array of filenames matching the pattern
   */
  private discoverCompanionPrompts(commandType: string): string[] {
    const companionPrompts: string[] = []

    try {
      const files = fs.readdirSync(this.basePath)
      const pattern = new RegExp(`^${commandType}-.*\\.yml$`)
      const matchingFiles = files.filter((file) => pattern.test(file))

      for (const file of matchingFiles) {
        companionPrompts.push(file)
      }
    } catch {
      // Return empty array if directory doesn't exist or can't be read
    }

    return companionPrompts.sort()
  }

  /**
   * Load and parse a prompt YAML file.
   *
   * @param filename - Filename to load
   * @returns Prompt content or null if not found
   */
  private loadPromptFile(filename: string): null | string {
    const fullPath = path.join(this.basePath, filename)

    if (!fs.existsSync(fullPath)) {
      return null
    }

    let yamlContent: string

    try {
      yamlContent = fs.readFileSync(fullPath, 'utf8')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      throw SystemPromptError.fileReadFailed(fullPath, reason)
    }

    const config = loadYaml(yamlContent) as PromptsYaml

    return config.prompt ?? null
  }
}
