import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {MemoryManager} from '../memory/memory-manager.js'

/**
 * Simple prompt configuration loaded from YAML
 */
export interface PromptConfig {
  description?: string
  excluded_tools?: string[]
  prompt: string
}

/**
 * Context for building system prompts
 */
export interface BuildContext {
  availableMarkers?: Record<string, string>
  availableTools?: string[]
  conversationMetadata?: {conversationId?: string; title?: string}
  memoryManager?: MemoryManager
}

/**
 * Simple prompt factory following Serena's design pattern.
 *
 * Key features:
 * - Loads simple YAML files with `prompt` field
 * - Uses basic {{variable}} template syntax
 * - No complex contributor pattern
 * - Direct concatenation of base + modes + dynamic content
 */
export class SimplePromptFactory {
  private readonly basePath: string
  private readonly cache: Map<string, PromptConfig> = new Map()
  private readonly verbose: boolean

  /**
   * Creates a new simple prompt factory
   *
   * @param basePath - Base path for prompt files (defaults to dist/resources/prompts)
   * @param verbose - Enable verbose debug output
   */
  public constructor(basePath?: string, verbose = false) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // When compiled: dist/infra/cipher/system-prompt/simple-prompt-factory.js
    // Resources are at: dist/resources/prompts/
    // So we need to go up 3 levels: ../../../resources/prompts
    this.basePath = basePath ?? path.join(currentDir, '../../../resources/prompts')
    this.verbose = verbose
  }

  /**
   * Build the complete system prompt
   *
   * @param context - Runtime context with tools, markers, modes, etc.
   * @returns Complete system prompt string
   */
  public async buildSystemPrompt(context: BuildContext = {}): Promise<string> {
    if (this.verbose) {
      console.log('[PromptDebug:SimpleFactory] Building system prompt')
      console.log('[PromptDebug:SimpleFactory] Context:', JSON.stringify({
        availableMarkers: Object.keys(context.availableMarkers ?? {}).length,
        availableTools: context.availableTools?.length,
      }, null, 2))
    }

    // 1. Load base prompt
    const basePrompt = this.loadPrompt('system-prompt.yml')

    // 2. Get memories if available
    const memories = context.memoryManager
      ? await this.formatMemories(context.memoryManager)
      : ''

    // 3. Prepare template variables
    // Note: Variable names use snake_case to match template placeholders ({{available_tools}}, etc.)
    /* eslint-disable camelcase */
    const vars = {
      available_markers: Object.keys(context.availableMarkers ?? {}).join(', '),
      available_tools: context.availableTools?.join(', ') ?? '',
      datetime: `<dateTime>Current date and time: ${new Date().toISOString()}</dateTime>`,
      memories,
    }
    /* eslint-enable camelcase */

    // 4. Render final prompt
    const finalPrompt = this.renderTemplate(basePrompt.prompt, vars)

    if (this.verbose) {
      console.log(`[PromptDebug:SimpleFactory] Final prompt: ${finalPrompt.length} chars`)
      console.log(`[PromptDebug:SimpleFactory] Preview (first 200): ${finalPrompt.slice(0, 200)}`)
      console.log(`[PromptDebug:SimpleFactory] Preview (last 200): ${finalPrompt.slice(-200)}`)
    }

    return finalPrompt
  }

  /**
   * Format memories for inclusion in system prompt
   *
   * @param memoryManager - Memory manager instance
   * @returns Formatted memories string
   */
  private async formatMemories(memoryManager: MemoryManager): Promise<string> {
    try {
      const memories = await memoryManager.list({limit: 20})
      if (!memories || memories.length === 0) {
        return ''
      }

      const items = memories.map((memory) => {
        const tags = memory.tags && memory.tags.length > 0
          ? ` [${memory.tags.join(', ')}]`
          : ''
        return `- ${memory.content}${tags}`
      })

      return `\n# Agent Memories\n${items.join('\n')}\n`
    } catch {
      return ''
    }
  }

  /**
   * Load a prompt YAML file
   *
   * @param filepath - Relative path from basePath
   * @returns Parsed prompt configuration
   */
  private loadPrompt(filepath: string): PromptConfig {
    // Check cache
    if (this.cache.has(filepath)) {
      if (this.verbose) {
        console.log(`[PromptDebug:SimpleFactory] Cache hit: ${filepath}`)
      }

      return this.cache.get(filepath)!
    }

    // Load from file
    const fullPath = path.join(this.basePath, filepath)

    if (this.verbose) {
      console.log(`[PromptDebug:SimpleFactory] Loading: ${fullPath}`)
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Prompt file not found: ${fullPath}`)
    }

    const yamlContent = fs.readFileSync(fullPath, 'utf8')
    const config = loadYaml(yamlContent) as PromptConfig

    if (!config.prompt) {
      throw new Error(`Invalid prompt file (missing 'prompt' field): ${filepath}`)
    }

    if (this.verbose) {
      console.log(`[PromptDebug:SimpleFactory] Loaded: ${yamlContent.length} bytes`)
    }

    // Cache the config
    this.cache.set(filepath, config)

    return config
  }

  /**
   * Render a template string with variable substitution
   *
   * Uses simple {{variable}} syntax (same as current PromptRenderer.render())
   *
   * @param template - Template string with {{variable}} placeholders
   * @param variables - Variables to substitute
   * @returns Rendered string
   */
  private renderTemplate(template: string, variables: Record<string, string>): string {
    if (this.verbose && Object.keys(variables).length > 0) {
      console.log(`[PromptDebug:SimpleFactory] Substituting variables:`, Object.keys(variables))
    }

    let result = template

    // Replace {{variable}} with values
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
      result = result.replaceAll(regex, value ?? '')
    }

    return result
  }
}
