import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'

import type {ContributorContext, SystemPromptContributor} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ValidatedPromptConfig} from '../schemas.js'

import {SystemPromptError} from '../../../../core/domain/cipher/errors/system-prompt-error.js'
import {PromptCache} from '../prompt-cache.js'
import {PromptConfigSchema} from '../schemas.js'

/**
 * Options for file contributor configuration.
 */
export interface FileContributorOptions {
  /** Base path for resolving relative file paths */
  basePath?: string
  /** Whether to cache file contents (default: true) */
  cache?: boolean
  /** Whether to render template variables (default: false) */
  renderTemplate?: boolean
  /** Whether to validate file modification time (default: true) */
  validateMtime?: boolean
}

/**
 * File contributor that loads prompt content from YAML files.
 *
 * Features:
 * - Loads and parses YAML prompt files
 * - Validates content using Zod schema
 * - Caches content with optional mtime validation
 */
export class FileContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly basePath: string
  private readonly cache: PromptCache<ValidatedPromptConfig>
  private readonly filepath: string
  private readonly renderTemplate: boolean
  private readonly useCache: boolean
  private readonly validateMtime: boolean

  /**
   * Creates a new file contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param filepath - Path to the YAML prompt file
   * @param options - Configuration options
   */
  public constructor(id: string, priority: number, filepath: string, options: FileContributorOptions = {}) {
    this.id = id
    this.priority = priority
    this.filepath = filepath
    this.basePath = options.basePath ?? ''
    this.useCache = options.cache ?? true
    this.renderTemplate = options.renderTemplate ?? false
    this.validateMtime = options.validateMtime ?? true
    this.cache = new PromptCache({
      maxSize: 50,
      validateMtime: this.validateMtime,
    })
  }

  /**
   * Loads and returns the prompt content from the file.
   *
   * @param context - Contributor context with template variables
   * @returns Prompt content string
   */
  public async getContent(context: ContributorContext): Promise<string> {
    const fullPath = this.basePath ? path.join(this.basePath, this.filepath) : this.filepath

    // Check cache first (only for raw content, not rendered)
    let prompt: string | undefined

    if (this.useCache) {
      const cached = this.cache.get(fullPath)

      if (cached?.prompt) {
        prompt = cached.prompt
      }
    }

    // Load from file if not cached
    if (!prompt) {
      if (!fs.existsSync(fullPath)) {
        throw SystemPromptError.fileNotFound(fullPath)
      }

      let yamlContent: string

      try {
        yamlContent = fs.readFileSync(fullPath, 'utf8')
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)

        throw SystemPromptError.fileReadFailed(fullPath, reason)
      }

      const rawConfig = loadYaml(yamlContent)

      // Validate with Zod schema
      const parseResult = PromptConfigSchema.safeParse(rawConfig)

      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join('; ')

        throw SystemPromptError.configInvalid(errorMessages, parseResult.error.errors)
      }

      const config = parseResult.data

      if (!config.prompt) {
        throw SystemPromptError.configMissingField('prompt', fullPath)
      }

      // Cache the config
      if (this.useCache) {
        this.cache.set(fullPath, config)
      }

      prompt = config.prompt
    }

    // Render template if enabled
    if (this.renderTemplate) {
      return this.renderTemplateVariables(prompt, context)
    }

    return prompt
  }

  /**
   * Invalidate the cache for this contributor's file.
   */
  public invalidateCache(): void {
    const fullPath = this.basePath ? path.join(this.basePath, this.filepath) : this.filepath
    this.cache.invalidate(fullPath)
  }

  /**
   * Render template variables in the prompt content.
   *
   * @param template - Template string with {{variable}} placeholders
   * @param context - Contributor context with values
   * @returns Rendered string
   */
  private renderTemplateVariables(template: string, context: ContributorContext): string {
    let result = template

    // Build variables from context
    /* eslint-disable camelcase */
    const variables: Record<string, string> = {
      available_markers: context.availableMarkers ? Object.keys(context.availableMarkers).join(', ') : '',
      available_tools: context.availableTools?.join(', ') ?? '',
      datetime: `<dateTime>Current date and time: ${new Date().toISOString()}</dateTime>`,
    }
    /* eslint-enable camelcase */

    // Replace {{variable}} with values
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
      result = result.replaceAll(regex, value ?? '')
    }

    return result
  }
}
