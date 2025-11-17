import fs from 'node:fs'
import path from 'node:path'

import {PromptRenderer} from '../resources/prompt-renderer.js'

/**
 * Template loader that searches multiple directories for template files.
 *
 * Supports:
 * - Multi-directory search (user overrides, defaults)
 * - Template caching for performance
 * - Inline template rendering
 */
export class TemplateLoader {
  private cache = new Map<string, string>()
  private renderer: PromptRenderer

  /**
   * Creates a new template loader.
   *
   * @param searchPaths - Directories to search for templates (order matters: first found wins)
   */
  public constructor(private searchPaths: string[]) {
    this.renderer = new PromptRenderer()
  }

  /**
   * Clear the template cache.
   * Useful for development or when templates are updated.
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get the number of cached templates.
   *
   * @returns Number of templates in cache
   */
  public getCacheSize(): number {
    return this.cache.size
  }

  /**
   * Load a template file by name.
   * Searches through all search paths and returns the first match.
   * Results are cached for performance.
   *
   * @param templateName - Name of the template file (without .yml extension)
   * @returns Template content as string
   * @throws Error if template is not found in any search path
   */
  public load(templateName: string): string {
    const cacheKey = templateName

    // Return cached template if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // Search for template in all paths
    for (const searchPath of this.searchPaths) {
      if (!fs.existsSync(searchPath)) {
        continue
      }

      const fullPath = path.join(searchPath, `${templateName}.yml`)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        this.cache.set(cacheKey, content)
        return content
      }
    }

    throw new Error(`Template not found: ${templateName} (searched in: ${this.searchPaths.join(', ')})`)
  }

  /**
   * Render a template with the provided context.
   *
   * @param templateName - Name of the template file, or 'inline' for inline templates
   * @param context - Variables to inject into the template
   * @returns Rendered template string
   */
  public render(templateName: string, context: Record<string, unknown>): string {
    let template: string

    if (templateName === 'inline') {
      // For inline templates, expect _template in context
      template = context._template as string
      if (!template) {
        throw new Error('Inline template rendering requires _template in context')
      }
    } else {
      // Load template from file
      template = this.load(templateName)
    }

    // Convert context to boolean/number/string values for PromptRenderer
    const variables: Record<string, boolean | number | string> = {}
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        variables[key] = value
      } else if (value !== null && value !== undefined) {
        variables[key] = String(value)
      }
    }

    return this.renderer.render(template, variables)
  }
}
