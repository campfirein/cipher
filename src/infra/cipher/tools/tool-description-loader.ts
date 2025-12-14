import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * Loads tool descriptions from external .txt files.
 *
 * This service enables tool descriptions to be stored in external files
 * for easier editing without code changes. It implements lazy loading
 * with caching for performance, following the same pattern as SimplePromptFactory.
 *
 * Features:
 * - Lazy loading: Descriptions are only loaded when requested
 * - Caching: Loaded descriptions are cached to avoid repeated file reads
 * - Fallback: Returns undefined if file not found, allowing inline fallback
 * - Path resolution: Handles compiled dist vs source paths automatically
 */
export class ToolDescriptionLoader {
  private readonly basePath: string
  private readonly cache: Map<string, string> = new Map()

  /**
   * Creates a new tool description loader.
   *
   * @param basePath - Base path for tool description files.
   *                   Defaults to dist/resources/tools/ relative to this file.
   */
  public constructor(basePath?: string) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    // When compiled: dist/infra/cipher/tools/tool-description-loader.js
    // Resources are at: dist/resources/tools/
    // So we need to go up 3 levels: ../../../resources/tools
    this.basePath = basePath ?? path.join(currentDir, '../../../resources/tools')
  }

  /**
   * Clear the description cache.
   * Useful for testing or hot-reloading descriptions.
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get the base path for tool descriptions.
   *
   * @returns The base path being used for loading descriptions
   */
  public getBasePath(): string {
    return this.basePath
  }

  /**
   * Check if a description file exists for a tool.
   *
   * @param toolName - Name of the tool
   * @returns True if the description file exists
   */
  public has(toolName: string): boolean {
    // Check cache first
    if (this.cache.has(toolName)) {
      return true
    }

    // Check file system
    const filePath = path.join(this.basePath, `${toolName}.txt`)
    return fs.existsSync(filePath)
  }

  /**
   * Load description for a tool from its .txt file.
   *
   * @param toolName - Name of the tool (e.g., 'bash_exec')
   * @returns Description text, or undefined if file not found
   */
  public load(toolName: string): string | undefined {
    // Check cache first
    if (this.cache.has(toolName)) {
      return this.cache.get(toolName)
    }

    // Build file path
    const filePath = path.join(this.basePath, `${toolName}.txt`)

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return undefined
    }

    // Load and cache the description
    try {
      const description = fs.readFileSync(filePath, 'utf8').trim()
      this.cache.set(toolName, description)
      return description
    } catch {
      // Return undefined on read errors (e.g., permission issues)
      return undefined
    }
  }

  /**
   * Preload descriptions for multiple tools.
   * Useful for batch initialization.
   *
   * @param toolNames - Array of tool names to preload
   * @returns Map of tool names to their descriptions (excludes not found)
   */
  public preload(toolNames: string[]): Map<string, string> {
    const loaded = new Map<string, string>()

    for (const toolName of toolNames) {
      const description = this.load(toolName)
      if (description !== undefined) {
        loaded.set(toolName, description)
      }
    }

    return loaded
  }
}
