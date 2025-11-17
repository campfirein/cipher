import {load as loadYaml} from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import type {
  BasePromptYaml,
  DateTimeYaml,
  ExecutionModesYaml,
  MarkerSectionsYaml,
  MemoryYaml,
  PromptResourceLoaderConfig,
} from './types.js'

/**
 * Resource loader for YAML-based prompts.
 *
 * Follows the same pattern as TemplateLoader for consistency:
 * - Loads YAML files from src/resources/prompts/
 * - Caches parsed YAML for performance
 * - Provides type-safe access to different prompt types
 */
export class PromptResourceLoader {
  private readonly basePath: string
  private readonly cache: Map<string, BasePromptYaml | DateTimeYaml | ExecutionModesYaml | MarkerSectionsYaml | MemoryYaml> = new Map()
  private readonly enableCaching: boolean

  /**
   * Creates a new prompt resource loader
   *
   * @param config - Configuration options
   */
  public constructor(config: PromptResourceLoaderConfig = {}) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // When compiled: dist/infra/cipher/resources/prompt-resource-loader.js
    // Resources are at: dist/resources/prompts/
    // So we need to go up 3 levels: ../../../resources/prompts
    this.basePath = config.basePath ?? path.join(currentDir, '../../../resources/prompts')
    this.enableCaching = config.enableCaching ?? true
  }

  /**
   * Clear the prompt cache.
   * Useful for development or when prompts are updated.
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get the base path for prompt resources
   *
   * @returns Base path
   */
  public getBasePath(): string {
    return this.basePath
  }

  /**
   * Get the number of cached prompts
   *
   * @returns Number of prompts in cache
   */
  public getCacheSize(): number {
    return this.cache.size
  }

  /**
   * Load the base cipher-agent system prompt
   *
   * @returns Parsed base prompt YAML
   */
  public async loadBasePrompt(): Promise<BasePromptYaml> {
    return this.loadPrompt('base', 'cipher-agent') as Promise<BasePromptYaml>
  }

  /**
   * Load datetime formatting template
   *
   * @returns Parsed datetime YAML
   */
  public async loadDateTime(): Promise<DateTimeYaml> {
    return this.loadPrompt('contributors', 'datetime') as Promise<DateTimeYaml>
  }

  /**
   * Load execution mode instructions
   *
   * @returns Parsed execution modes YAML
   */
  public async loadExecutionModes(): Promise<ExecutionModesYaml> {
    return this.loadPrompt('contributors', 'execution-modes') as Promise<ExecutionModesYaml>
  }

  /**
   * Load marker-based prompt sections
   *
   * @returns Parsed marker sections YAML
   */
  public async loadMarkerSections(): Promise<MarkerSectionsYaml> {
    return this.loadPrompt('contributors', 'marker-sections') as Promise<MarkerSectionsYaml>
  }

  /**
   * Load memory formatting configuration
   *
   * @returns Parsed memory YAML
   */
  public async loadMemory(): Promise<MemoryYaml> {
    return this.loadPrompt('contributors', 'memory') as Promise<MemoryYaml>
  }

  /**
   * Load a prompt YAML file from a specific category
   *
   * @param category - Subdirectory (e.g., 'base', 'contributors')
   * @param filename - YAML filename without extension
   * @returns Parsed YAML content
   */
  public async loadPrompt(
    category: string,
    filename: string,
  ): Promise<BasePromptYaml | DateTimeYaml | ExecutionModesYaml | MarkerSectionsYaml | MemoryYaml> {
    const cacheKey = `${category}/${filename}`

    // Return cached if available
    if (this.enableCaching && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // Build full path
    const fullPath = path.join(this.basePath, category, `${filename}.yml`)

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Prompt resource not found: ${fullPath}`)
    }

    // Load and parse YAML
    const yamlContent = fs.readFileSync(fullPath, 'utf8')
    const parsed = loadYaml(yamlContent) as BasePromptYaml | DateTimeYaml | ExecutionModesYaml | MarkerSectionsYaml | MemoryYaml

    // Cache if enabled
    if (this.enableCaching) {
      this.cache.set(cacheKey, parsed)
    }

    return parsed
  }
}
