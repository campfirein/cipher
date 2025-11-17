import nunjucks from 'nunjucks'

/**
 * Jinja2-like template engine wrapper using Nunjucks.
 *
 * Provides template rendering with support for:
 * - Variables: {{ variable }}
 * - Conditionals: {% if condition %}...{% endif %}
 * - Loops: {% for item in items %}...{% endfor %}
 * - Filters and expressions
 */
export class JinjaTemplate {
  private env: nunjucks.Environment

  /**
   * Creates a new Jinja template engine instance.
   *
   * @param searchPaths - Optional array of directories to search for templates
   */
  public constructor(searchPaths?: string[]) {
    // Create environment with file system loader if paths provided
    if (searchPaths && searchPaths.length > 0) {
      const loader = new nunjucks.FileSystemLoader(searchPaths, {
        noCache: false,
        watch: false,
      })
      this.env = new nunjucks.Environment(loader, {
        autoescape: false, // Don't escape HTML (we're generating text prompts)
        lstripBlocks: true, // Remove leading whitespace from blocks
        trimBlocks: true, // Remove trailing newline after blocks
      })
    } else {
      // Create environment without loader for string templates
      this.env = new nunjucks.Environment(null, {
        autoescape: false,
        lstripBlocks: true,
        trimBlocks: true,
      })
    }
  }

  /**
   * Render a template string with the provided context.
   *
   * @param template - The template string to render
   * @param context - Variables to inject into the template
   * @returns Rendered template string
   */
  public render(template: string, context: Record<string, unknown>): string {
    return this.env.renderString(template, context)
  }

  /**
   * Render a template file by name.
   *
   * @param templateName - Name of the template file (relative to search paths)
   * @param context - Variables to inject into the template
   * @returns Rendered template string
   */
  public renderFile(templateName: string, context: Record<string, unknown>): string {
    return this.env.render(templateName, context)
  }
}
