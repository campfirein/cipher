import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {ContributorContext, SystemPromptContributor} from '../../core/domain/system-prompt/types.js'
import type {ValidatedContributorConfig} from './contributor-schemas.js'

import {getAgentRegistry} from '../../core/domain/agent/agent-registry.js'
import {SystemPromptError} from '../../core/domain/errors/system-prompt-error.js'
import {ContributorConfigSchema} from './contributor-schemas.js'
import {
  AgentPromptContributor,
  DateTimeContributor,
  EnvironmentContributor,
  FileContributor,
  MemoryContributor,
  StaticContributor,
} from './contributors/index.js'

/**
 * Reflection prompt type for iteration-based prompts.
 */
export type ReflectionType = 'completion_check' | 'final_iteration' | 'mid_point_check' | 'near_max_iterations'

/**
 * Context for building reflection prompts.
 */
export interface ReflectionContext {
  /** Current iteration number (required for near_max_iterations and mid_point_check) */
  currentIteration?: number
  /** Maximum iterations allowed (required for near_max_iterations and mid_point_check) */
  maxIterations?: number
  /** Type of reflection prompt to build */
  type: ReflectionType
}

/**
 * Internal structure for YAML files with prompts.
 */
interface PromptsYaml {
  description?: string
  prompt?: string
  prompts?: Record<string, string>
}

/**
 * Options for SystemPromptManager configuration.
 */
export interface SystemPromptManagerOptions {
  /** Base path for file contributors (defaults to current directory) */
  basePath?: string
  /** Whether to validate contributor configs with Zod (default: true) */
  validateConfig?: boolean
}

/**
 * SystemPromptManager orchestrates contributor-based prompt composition.
 *
 * Features:
 * - Registers and manages multiple contributors
 * - Builds prompts in parallel for performance
 * - Validates contributor configurations with Zod
 * - Sorts contributors by priority
 */
export class SystemPromptManager {
  private readonly basePath: string
  private contributors: SystemPromptContributor[] = []
  private readonly validateConfig: boolean

  /**
   * Creates a new SystemPromptManager.
   *
   * @param options - Configuration options
   */
  public constructor(options: SystemPromptManagerOptions = {}) {
    this.basePath = options.basePath ?? ''
    this.validateConfig = options.validateConfig ?? true
  }

  /**
   * Build the complete system prompt using all contributors in parallel.
   *
   * Contributors are executed concurrently and their outputs are
   * concatenated in priority order.
   *
   * @param context - Runtime context with dependencies
   * @returns Complete system prompt string
   */
  public async build(context: ContributorContext): Promise<string> {
    if (this.contributors.length === 0) {
      return ''
    }

    // Execute all contributors in parallel
    const results = await Promise.all(
      this.contributors.map(async (contributor) => {
        try {
          const content = await contributor.getContent(context)

          return {content, error: null, id: contributor.id}
        } catch (error) {
          return {
            content: '',
            error: error instanceof Error ? error.message : String(error),
            id: contributor.id,
          }
        }
      }),
    )

    // Check for errors
    const errors = results.filter((r) => r.error !== null)

    if (errors.length > 0) {
      const firstError = errors[0]

      throw SystemPromptError.contributorExecutionFailed(firstError.id, firstError.error!)
    }

    // Combine content from all contributors
    return results
      .map((r) => r.content)
      .filter(Boolean)
      .join('\n\n')
  }

  /**
   * Build a system prompt specifically for an agent.
   *
   * This method builds the prompt by:
   * 1. Getting the agent configuration from the registry
   * 2. Loading the agent's prompt (from promptFile or inline prompt)
   * 3. Combining it with base contributors (datetime, environment, etc.)
   *
   * @param agentName - Name of the agent (e.g., 'plan', 'query', 'curate')
   * @param context - Runtime context with dependencies
   * @returns Complete system prompt for the agent
   */
  public async buildForAgent(agentName: string, context: ContributorContext): Promise<string> {
    const registry = getAgentRegistry()
    const agent = registry.get(agentName)

    if (!agent) {
      // Unknown agent - fall back to default build
      return this.build(context)
    }

    // Create agent prompt contributor
    const agentContributor = new AgentPromptContributor('agent', 5, {
      basePath: this.basePath,
      cache: true,
    })

    // Build context with agent name for the contributor
    const agentContext = {
      ...context,
      agentName,
    }

    // Get agent-specific prompt
    const agentPrompt = await agentContributor.getContent(agentContext)

    // If agent has no custom prompt, use default build
    if (!agentPrompt) {
      return this.build(context)
    }

    // Build base prompt from existing contributors
    const basePrompt = await this.build(context)

    // Combine: agent prompt takes precedence, then base prompt
    // Agent prompt comes first as it defines the agent's role
    if (basePrompt) {
      return `${agentPrompt}\n\n${basePrompt}`
    }

    return agentPrompt
  }

  /**
   * Build a reflection prompt for completion checking.
   *
   * @param context - Context with iteration information
   * @returns Formatted reflection prompt
   */
  public buildReflectionPrompt(context: ReflectionContext): string {
    const reflectionConfig = this.loadYamlFile('reflection.yml')

    if (!reflectionConfig.prompts) {
      throw SystemPromptError.configMissingField('prompts', 'reflection.yml')
    }

    const template = reflectionConfig.prompts[context.type]

    if (!template) {
      throw SystemPromptError.configMissingField(`prompts.${context.type}`, 'reflection.yml')
    }

    if (context.type === 'near_max_iterations' && context.currentIteration && context.maxIterations) {
      /* eslint-disable camelcase */
      return this.renderTemplate(template, {
        current_iteration: context.currentIteration.toString(),
        max_iterations: context.maxIterations.toString(),
      })
      /* eslint-enable camelcase */
    }

    if (context.type === 'mid_point_check' && context.currentIteration && context.maxIterations) {
      const remaining = context.maxIterations - context.currentIteration

      /* eslint-disable camelcase */
      return this.renderTemplate(template, {
        current_iteration: context.currentIteration.toString(),
        remaining_iterations: remaining.toString(),
      })
      /* eslint-enable camelcase */
    }

    return template
  }

  /**
   * Clear all registered contributors.
   */
  public clearContributors(): void {
    this.contributors = []
  }

  /**
   * Get the list of registered contributors.
   *
   * @returns Array of contributors (copy)
   */
  public getContributors(): SystemPromptContributor[] {
    return [...this.contributors]
  }

  /**
   * Get tool-specific output guidance for a tool.
   *
   * @param toolName - The name of the tool (e.g., 'curate')
   * @returns The guidance text if available, null otherwise
   */
  public getToolOutputGuidance(toolName: string): null | string {
    try {
      const toolOutputsConfig = this.loadYamlFile('tool-outputs.yml')

      if (toolOutputsConfig.prompts) {
        const promptKey = `${toolName}_output`
        const guidance = toolOutputsConfig.prompts[promptKey]

        if (guidance) {
          return guidance
        }
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Register a single contributor directly.
   *
   * @param contributor - Contributor instance to register
   */
  public registerContributor(contributor: SystemPromptContributor): void {
    this.contributors.push(contributor)
    this.sortContributors()
  }

  /**
   * Register contributors from configuration objects.
   *
   * Validates configs with Zod if validateConfig is enabled,
   * creates contributor instances, and sorts by priority.
   *
   * @param configs - Array of contributor configuration objects
   */
  public registerContributors(configs: ValidatedContributorConfig[]): void {
    for (const config of configs) {
      // Validate config if enabled
      if (this.validateConfig) {
        const parseResult = ContributorConfigSchema.safeParse(config)

        if (!parseResult.success) {
          const errorMessages = parseResult.error.errors
            .map((err) => `${err.path.join('.')}: ${err.message}`)
            .join('; ')

          throw SystemPromptError.configInvalid(errorMessages, parseResult.error.errors)
        }
      }

      // Skip disabled contributors
      if (config.enabled === false) {
        continue
      }

      const contributor = this.createContributor(config)
      this.contributors.push(contributor)
    }

    this.sortContributors()
  }

  /**
   * Create a contributor instance from configuration.
   *
   * @param config - Validated contributor configuration
   * @returns Contributor instance
   */
  private createContributor(config: ValidatedContributorConfig): SystemPromptContributor {
    switch (config.type) {
      case 'dateTime': {
        return new DateTimeContributor(config.id, config.priority)
      }

      case 'environment': {
        return new EnvironmentContributor(config.id, config.priority)
      }

      case 'file': {
        return new FileContributor(config.id, config.priority, config.filepath, {
          basePath: this.basePath,
          cache: config.options?.cache,
          validateMtime: config.options?.validateMtime,
        })
      }

      case 'memory': {
        return new MemoryContributor(config.id, config.priority, {
          includeTags: config.options?.includeTags,
          limit: config.options?.limit,
          pinnedOnly: config.options?.pinnedOnly,
        })
      }

      case 'static': {
        return new StaticContributor(config.id, config.priority, config.content)
      }

      default: {
        // Exhaustive check - TypeScript will error if we miss a case
        const _exhaustive: never = config

        throw SystemPromptError.contributorInvalidConfig(_exhaustive)
      }
    }
  }

  /**
   * Load and parse a YAML file from the base path.
   *
   * @param filename - Relative filename to load
   * @returns Parsed YAML content
   */
  private loadYamlFile(filename: string): PromptsYaml {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const defaultBasePath = path.join(currentDir, '../../resources/prompts')
    const basePath = this.basePath || defaultBasePath
    const fullPath = path.join(basePath, filename)

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

    return loadYaml(yamlContent) as PromptsYaml
  }

  /**
   * Render a template string with variable substitution.
   *
   * Uses simple {{variable}} syntax.
   *
   * @param template - Template string with {{variable}} placeholders
   * @param variables - Variables to substitute
   * @returns Rendered string
   */
  private renderTemplate(template: string, variables: Record<string, string>): string {
    let result = template

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
      result = result.replaceAll(regex, value ?? '')
    }

    return result
  }

  /**
   * Sort contributors by priority (lower = first).
   */
  private sortContributors(): void {
    this.contributors.sort((a, b) => a.priority - b.priority)
  }
}
