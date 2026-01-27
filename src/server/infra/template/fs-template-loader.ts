import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {type IFileService} from '../../core/interfaces/services/i-file-service.js'
import {type ITemplateLoader} from '../../core/interfaces/services/i-template-loader.js'

/**
 * File system-based template loader.
 * Loads templates from src/templates/ directory and performs variable substitution.
 */
export class FsTemplateLoader implements ITemplateLoader {
  private readonly templatesDir: string

  constructor(private readonly fileService: IFileService) {
    // Get the directory of this file
    const currentFileUrl = import.meta.url
    const currentFilePath = fileURLToPath(currentFileUrl)
    const currentDir = path.dirname(currentFilePath)

    // Navigate from src/infra/template/ to src/templates/
    this.templatesDir = path.join(currentDir, '..', '..', 'templates')
  }

  /**
   * Loads a section template from the sections/ directory.
   * @param sectionName - Name of the section (e.g., 'workflow', 'command-reference')
   * @returns Promise resolving to section content
   * @throws Error if section file cannot be read
   */
  async loadSection(sectionName: string): Promise<string> {
    const sectionPath = `sections/${sectionName}.md`
    return this.loadTemplate(sectionPath)
  }

  /**
   * Loads a template file from the templates directory.
   * @param templatePath - Relative path to template (e.g., 'base.md', 'sections/workflow.md')
   * @returns Promise resolving to template content
   * @throws Error if template file cannot be read
   */
  async loadTemplate(templatePath: string): Promise<string> {
    const fullPath = path.join(this.templatesDir, templatePath)

    try {
      const content = await this.fileService.read(fullPath)
      return content
    } catch (error) {
      throw new Error(
        `Failed to load template '${templatePath}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Substitutes variables in a template string.
   * Replaces {{variable_name}} with corresponding values from context.
   * @param template - Template string with {{variable}} placeholders
   * @param context - Object mapping variable names to values
   * @returns Template with variables replaced
   */
  substituteVariables(template: string, context: Record<string, string>): string {
    let result = template

    // Replace each variable in the context
    for (const [key, value] of Object.entries(context)) {
      const placeholder = `{{${key}}}`
      // Use global replace to handle multiple occurrences
      result = result.replaceAll(placeholder, value)
    }

    return result
  }
}
