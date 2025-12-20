import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'

import type {ContributorContext, SystemPromptContributor} from '../../../../core/domain/cipher/system-prompt/types.js'
import type {ValidatedPromptConfig} from '../schemas.js'

import {getAgentRegistry} from '../../../../core/domain/cipher/agent/agent-registry.js'
import {SystemPromptError} from '../../../../core/domain/cipher/errors/system-prompt-error.js'
import {PromptCache} from '../prompt-cache.js'
import {PromptConfigSchema} from '../schemas.js'

/**
 * Options for agent prompt contributor configuration.
 */
export interface AgentPromptContributorOptions {
  /** Base path for resolving relative file paths */
  basePath?: string
  /** Whether to cache file contents (default: true) */
  cache?: boolean
}

/**
 * Agent prompt contributor that loads agent-specific prompts from YAML files.
 *
 * This contributor reads the agent's prompt configuration from the agent registry
 * and loads the corresponding YAML prompt file. It supports:
 * - Loading prompts from the agent's `promptFile` configuration
 * - Falling back to inline `prompt` if no promptFile is specified
 * - Caching loaded prompts for performance
 *
 * The agent name is typically passed via the ContributorContext.
 */
export class AgentPromptContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly basePath: string
  private readonly cache: PromptCache<ValidatedPromptConfig>
  private readonly useCache: boolean

  /**
   * Creates a new agent prompt contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param options - Configuration options
   */
  public constructor(id: string, priority: number, options: AgentPromptContributorOptions = {}) {
    this.id = id
    this.priority = priority
    this.basePath = options.basePath ?? ''
    this.useCache = options.cache ?? true
    this.cache = new PromptCache({
      maxSize: 20,
      validateMtime: true,
    })
  }

  /**
   * Loads and returns the agent-specific prompt content.
   *
   * The agent name should be provided in the context. If no agent name
   * is specified, or the agent has no prompt configured, returns an empty string.
   *
   * @param context - Contributor context with agent name
   * @returns Agent prompt content string
   */
  public async getContent(context: ContributorContext): Promise<string> {
    // Get agent name from context (extended property)
    const {agentName} = context as ContributorContext & {agentName?: string}

    if (!agentName) {
      // No agent specified, return empty
      return ''
    }

    // Get agent from registry
    const registry = getAgentRegistry()
    const agent = registry.get(agentName)

    if (!agent) {
      // Unknown agent, return empty
      return ''
    }

    // Check for inline prompt first (takes precedence if promptFile is not specified)
    if (agent.prompt && !agent.promptFile) {
      return agent.prompt
    }

    // Load from promptFile if specified
    if (agent.promptFile) {
      return this.loadPromptFile(agent.promptFile)
    }

    // No prompt configured for this agent
    return ''
  }

  /**
   * Invalidate the cache for a specific file.
   *
   * @param filepath - Path to the file to invalidate
   */
  public invalidateCache(filepath?: string): void {
    if (filepath) {
      const fullPath = this.basePath ? path.join(this.basePath, filepath) : filepath
      this.cache.invalidate(fullPath)
    }
  }

  /**
   * Load prompt content from a YAML file.
   *
   * @param filepath - Path to the YAML prompt file
   * @returns Prompt content string
   */
  private loadPromptFile(filepath: string): string {
    const fullPath = this.basePath ? path.join(this.basePath, filepath) : filepath

    // Check cache first
    if (this.useCache) {
      const cached = this.cache.get(fullPath)

      if (cached?.prompt) {
        return cached.prompt
      }
    }

    // Load from file
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

    return config.prompt
  }
}
