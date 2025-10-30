/**
 * Interface for loading and processing template files.
 * Supports loading templates from various sources and performing variable substitution.
 */
export interface ITemplateLoader {
  /**
   * Loads a section template by name.
   * Convenience method that loads from the sections/ directory.
   * @param sectionName - Name of the section (e.g., 'workflow', 'command-reference')
   * @returns Promise resolving to the section content as a string
   * @throws Error if the section file cannot be found or read
   */
  loadSection(sectionName: string): Promise<string>

  /**
   * Loads a template file from the specified path.
   * @param templatePath - Relative path to the template file (e.g., 'base.md', 'sections/workflow.md')
   * @returns Promise resolving to the template content as a string
   * @throws Error if the template file cannot be found or read
   */
  loadTemplate(templatePath: string): Promise<string>

  /**
   * Substitutes variables in a template string.
   * Replaces {{variable_name}} with corresponding values from the context.
   * @param template - Template string containing variables to substitute
   * @param context - Object containing variable values (e.g., {agent_name: 'Claude Code'})
   * @returns Template string with variables replaced by their values
   */
  substituteVariables(template: string, context: Record<string, string>): string
}
