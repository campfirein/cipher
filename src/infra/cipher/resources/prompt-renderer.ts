import type {BasePromptSection, ExecutionMode, MarkerSection, ToolDescription} from './types.js'

/**
 * Extended tool structure that can appear in marker sections
 * Combines properties from ToolDescription and MarkerSection
 */
interface ExtendedToolDescription extends ToolDescription {
  examples?: MarkerSection['examples']
  intro?: string
  purpose?: string
  workflow?: MarkerSection['workflow']
}

/**
 * Flexible section structure for rendering
 */
interface FlexibleSection {
  content?: string
  header?: string
  items?: Array<BasePromptSection | string>
  points?: string[]
  steps?: Array<{
    content?: string
    description?: string
    items?: string[]
    step?: number
    title?: string
  }>
  title?: string
  tools?: Record<string, ToolDescription>
}

/**
 * Renderer for converting YAML prompt structures to formatted strings.
 *
 * Handles:
 * - Variable substitution ({{variableName}} syntax)
 * - Section rendering with proper formatting
 * - Conditional sections
 * - Nested structures
 */
export class PromptRenderer {
  /**
   * Render a template string with variable substitution
   *
   * @param template - Template string with {{variable}} placeholders
   * @param variables - Variables to substitute
   * @returns Rendered string
   */
  public render(template: string, variables: Record<string, boolean | number | string> = {}): string {
    let result = template

    // Replace {{variable}} with values
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g')
      result = result.replaceAll(regex, String(value ?? ''))
    }

    return result
  }

  /**
   * Render base prompt sections (from cipher-agent.yml)
   *
   * @param sections - Sections object from base prompt YAML
   * @param variables - Variables for substitution
   * @returns Rendered base prompt
   */
  public renderBasePrompt(
    sections: Record<string, BasePromptSection>,
    variables: Record<string, boolean | number | string> = {},
  ): string {
    const parts: string[] = []

    for (const section of Object.values(sections)) {
      if (!section) continue

      // Handle simple content
      if (section.content) {
        parts.push(this.render(section.content, variables))
        continue
      }

      // Build section parts
      const sectionParts: string[] = []

      // Add header if present
      if (section.header) {
        sectionParts.push(this.render(section.header, variables))
      }

      // Handle items array
      if (section.items && Array.isArray(section.items)) {
        const items = section.items.map((item: string) => `- ${this.render(item, variables)}`)
        sectionParts.push(items.join('\n'))
      }

      // Handle tools object
      if (section.tools) {
        sectionParts.push(this.renderTools(section.tools, variables))
      }

      // Handle points array
      if (section.points && Array.isArray(section.points)) {
        const points = section.points.map((point: string) => `- ${this.render(point, variables)}`)
        sectionParts.push(points.join('\n'))
      }

      // Handle steps array
      if (section.steps && Array.isArray(section.steps)) {
        const steps = section.steps.map((step, index: number) => {
          const stepNumber = step.step ?? index + 1
          return `${stepNumber}. ${this.render(step.content ?? '', variables)}`
        })
        sectionParts.push(steps.join('\n'))
      }

      if (sectionParts.length > 0) {
        parts.push(sectionParts.join('\n'))
      }
    }

    return parts.join('\n\n')
  }

  /**
   * Render a list of bullet points
   *
   * @param items - Array of items
   * @param bulletChar - Bullet character (default: '-')
   * @param variables - Variables for substitution
   * @returns Rendered bullet list
   */
  public renderBulletList(
    items: string[],
    bulletChar: string = '-',
    variables: Record<string, boolean | number | string> = {},
  ): string {
    return items.map((item) => `${bulletChar} ${this.render(item, variables)}`).join('\n')
  }

  /**
   * Render a conditional section (only if condition is true)
   *
   * @param section - Section to render
   * @param condition - Whether to render the section
   * @param variables - Variables for substitution
   * @returns Rendered section or empty string
   */
  public renderConditional(
    section: BasePromptSection | string,
    condition: boolean,
    variables: Record<string, boolean | number | string> = {},
  ): string {
    if (!condition) {
      return ''
    }

    return this.renderSection(section, variables)
  }

  /**
   * Render execution mode sections (from execution-modes.yml)
   *
   * @param modes - Execution modes object from YAML
   * @param context - Runtime context with mode flags and metadata
   * @param context.conversationId - Optional conversation ID for substitution
   * @param context.conversationTitle - Optional conversation title for substitution
   * @param context.isJsonInputMode - Flag indicating if JSON input mode is enabled
   * @param variables - Variables for substitution
   * @returns Rendered execution mode sections
   */
  public renderExecutionModes(
    modes: Record<string, ExecutionMode>,
    context: {conversationId?: string; conversationTitle?: string; isJsonInputMode?: boolean},
    variables: Record<string, boolean | number | string> = {},
  ): string {
    const sections: string[] = []

    for (const modeData of Object.values(modes)) {
      // Check if this mode should be included based on trigger
      if (modeData.trigger === 'isJsonInputMode' && context.isJsonInputMode !== true) {
        continue
      }

      const modeParts: string[] = []

      // Render header
      if (modeData.header) {
        modeParts.push(this.renderExecutionModeHeader(modeData.header, context, variables))
      }

      // Render sections
      if (modeData.sections) {
        for (const section of Object.values(modeData.sections)) {
          const sectionParts = this.renderExecutionModeSection(section, variables)
          if (sectionParts.length > 0) {
            modeParts.push(sectionParts.join('\n'))
          }
        }
      }

      if (modeParts.length > 0) {
        sections.push(modeParts.join('\n'))
      }
    }

    return sections.length > 0 ? '\n' + sections.join('\n') : ''
  }

  /**
   * Render marker-based sections (from marker-sections.yml)
   *
   * @param markers - Markers object from YAML
   * @param availableMarkers - Set of available marker strings
   * @param availableTools - Array of available tool names
   * @param variables - Variables for substitution
   * @returns Rendered marker sections
   */
  public renderMarkerSections(
    markers: Record<string, MarkerSection>,
    availableMarkers: Set<string>,
    availableTools: string[],
    variables: Record<string, boolean | number | string> = {},
  ): string {
    const sections: string[] = []

    for (const [markerName, markerData] of Object.entries(markers)) {
      // Skip if marker is not available
      if (!availableMarkers.has(markerName)) {
        continue
      }

      const sectionParts: string[] = []

      // Add section title
      if (markerData.section_title) {
        sectionParts.push(`\n## ${this.render(markerData.section_title, variables)}`)
      }

      // Handle simple content
      if (markerData.content) {
        sectionParts.push(this.render(markerData.content, variables))
      }

      // Handle header
      if (markerData.header) {
        sectionParts.push(this.render(markerData.header, variables))
      }

      // Handle tools
      if (markerData.tools) {
        const toolParts: string[] = []

        for (const [toolName, toolData] of Object.entries(markerData.tools)) {
          // Skip if tool is not available
          if (!availableTools.includes(toolName)) {
            continue
          }

          toolParts.push(...this.renderMarkerTool(toolName, toolData as ExtendedToolDescription & MarkerSection | string, variables))
        }

        if (toolParts.length > 0) {
          sectionParts.push(toolParts.join('\n'))
        }
      }

      // Handle best practice
      if (markerData.best_practice) {
        let bestPractice = '**Best Practice**: '

        if (markerData.best_practice.emphasis) {
          bestPractice += `${markerData.best_practice.emphasis} `
        }

        bestPractice += this.render(markerData.best_practice.content, variables)
        sectionParts.push(`\n${bestPractice}`)
      }

      if (sectionParts.length > 0) {
        sections.push(sectionParts.join('\n'))
      }
    }

    return sections.length > 0 ? '\n' + sections.join('\n') : ''
  }

  /**
   * Render a single section object
   *
   * @param section - Section object from YAML
   * @param variables - Variables for substitution
   * @returns Rendered section string
   */
  public renderSection(
    section: BasePromptSection | FlexibleSection | string,
    variables: Record<string, boolean | number | string> = {},
  ): string {
    if (typeof section === 'string') {
      return this.render(section, variables)
    }

    if (typeof section === 'object' && section !== null) {
      const sectionObj = section as FlexibleSection
      // Handle content field
      if (sectionObj.content) {
        return this.render(sectionObj.content, variables)
      }

      // Handle nested structures
      const parts: string[] = []

      if (sectionObj.title) {
        parts.push(this.render(sectionObj.title, variables))
      }

      if (sectionObj.header) {
        parts.push(this.render(sectionObj.header, variables))
      }

      if (sectionObj.items && Array.isArray(sectionObj.items)) {
        const items = sectionObj.items.map((item: BasePromptSection | string) => {
          if (typeof item === 'string') {
            return `- ${this.render(item, variables)}`
          }

          return `- ${this.renderSection(item, variables)}`
        })
        parts.push(items.join('\n'))
      }

      if (sectionObj.steps && Array.isArray(sectionObj.steps)) {
        const steps = sectionObj.steps.map((step, index: number) => {
          const stepNumber = step.step ?? index + 1
          let stepText = `${stepNumber}. `

          if (step.title) {
            stepText += `**${this.render(step.title, variables)}**`
          }

          if (step.description) {
            stepText += ` - ${this.render(step.description, variables)}`
          }

          if (step.items && Array.isArray(step.items)) {
            const items = step.items.map((item: string) => `   - ${this.render(item, variables)}`)
            stepText += '\n' + items.join('\n')
          }

          if (step.content) {
            stepText = `${stepNumber}. ${this.render(step.content, variables)}`
          }

          return stepText
        })
        parts.push(steps.join('\n'))
      }

      return parts.join('\n')
    }

    return ''
  }

  /**
   * Render an array of sections to a formatted string
   *
   * @param sections - Array of section objects
   * @param variables - Variables for substitution
   * @returns Rendered sections joined with newlines
   */
  public renderSections(
    sections: Array<BasePromptSection | string>,
    variables: Record<string, boolean | number | string> = {},
  ): string {
    return sections
      .map((section) => this.renderSection(section, variables))
      .filter((s) => s.length > 0)
      .join('\n\n')
  }

  /**
   * Render tool descriptions
   *
   * @param tools - Tool descriptions object
   * @param variables - Variables for substitution
   * @returns Rendered tool descriptions
   */
  public renderTools(
    tools: Record<string, string | ToolDescription>,
    variables: Record<string, boolean | number | string> = {},
  ): string {
    const toolDescriptions: string[] = []

    for (const [toolName, toolInfo] of Object.entries(tools)) {
      if (typeof toolInfo === 'string') {
        toolDescriptions.push(`- **${toolName}**: ${this.render(toolInfo, variables)}`)
      } else if (toolInfo.description) {
        toolDescriptions.push(`- **${toolName}**: ${this.render(toolInfo.description, variables)}`)
      } else if (toolInfo.header) {
        const parts = [this.render(toolInfo.header, variables)]

        if (toolInfo.features && Array.isArray(toolInfo.features)) {
          const features = toolInfo.features.map((f: string) => `- ${this.render(f, variables)}`)
          parts.push(features.join('\n'))
        }

        toolDescriptions.push(parts.join('\n'))
      }
    }

    return toolDescriptions.join('\n')
  }

  /**
   * Render execution mode header
   *
   * @param header - Header object from execution mode
   * @param context - Runtime context with conversation metadata
   * @param context.conversationId - Optional conversation ID for substitution
   * @param context.conversationTitle - Optional conversation title for substitution
   * @param variables - Variables for substitution
   * @returns Rendered header text
   */
  private renderExecutionModeHeader(
    header: NonNullable<ExecutionMode['header']>,
    context: {conversationId?: string; conversationTitle?: string},
    variables: Record<string, boolean | number | string>,
  ): string {
    let headerText = ''

    if (header.title) {
      headerText += `\n## ${this.render(header.title, variables)}\n`
    }

    if (header.content) {
      headerText += '\n' + this.render(header.content, variables)
    }

    if (header.note) {
      // Substitute conversation metadata
      const noteVars = {
        ...variables,
        conversationId: context.conversationId ?? 'unknown',
        conversationTitle: context.conversationTitle ?? 'Imported Conversation',
      }
      headerText += '\n' + this.render(header.note, noteVars)
    }

    return headerText
  }

  /**
   * Render a single execution mode section
   *
   * @param section - Section object from execution mode
   * @param variables - Variables for substitution
   * @returns Array of rendered section parts
   */
  private renderExecutionModeSection(
    section: BasePromptSection,
    variables: Record<string, boolean | number | string>,
  ): string[] {
    const sectionParts: string[] = []

    if (section.header) {
      sectionParts.push(this.render(section.header, variables))
    }

    if (section.content) {
      sectionParts.push(this.render(section.content, variables))
    }

    if (section.items) {
      const items = section.items.map((item: string) => `- ${this.render(item, variables)}`)
      sectionParts.push(items.join('\n'))
    }

    if (section.points) {
      const points = section.points.map((point: string) => `- ${this.render(point, variables)}`)
      sectionParts.push(points.join('\n'))
    }

    if (section.steps) {
      const steps = section.steps.map((step) => {
        let stepText = `${step.step ?? 0}. `

        if (step.title) {
          stepText += `**${this.render(step.title, variables)}**`
        }

        if (step.content) {
          stepText += ` ${this.render(step.content, variables)}`
        }

        if (step.items && step.items.length > 0) {
          stepText += '\n' + step.items.map((item: string) => `   ${this.render(item, variables)}`).join('\n')
        }

        return stepText
      })
      sectionParts.push(steps.join('\n'))
    }

    if (section.example) {
      sectionParts.push(this.render(section.example, variables))
    }

    if (section.tool_returns) {
      sectionParts.push(this.render(section.tool_returns, variables))
    }

    if (section.example_template) {
      sectionParts.push(this.render(section.example_template, variables))
    }

    if (section.footer) {
      sectionParts.push(this.render(section.footer, variables))
    }

    return sectionParts
  }

  /**
   * Render a single tool from marker section
   *
   * @param toolName - Name of the tool
   * @param toolData - Tool data (string or object)
   * @param variables - Variables for substitution
   * @returns Rendered tool parts
   */
  private renderMarkerTool(
    toolName: string,
    toolData: ExtendedToolDescription & MarkerSection | string,
    variables: Record<string, boolean | number | string>,
  ): string[] {
    const toolParts: string[] = []

    if (typeof toolData === 'string') {
      toolParts.push(`- **${toolName}**: ${this.render(toolData, variables)}`)
      return toolParts
    }

    const tool = toolData as ExtendedToolDescription & MarkerSection
    if (tool.intro) {
      toolParts.push(this.render(tool.intro, variables))
    }

    if (tool.workflow) {
      toolParts.push(...this.renderToolWorkflow(tool.workflow, variables))
    }

    if (tool.examples) {
      toolParts.push(...this.renderToolExamples(tool.examples, variables))
    }

    if (tool.purpose) {
      toolParts.push(`\n${this.render(tool.purpose, variables)}`)
    }

    if (tool.intro && tool.features) {
      toolParts.push(this.render(tool.intro, variables))
      for (const feature of tool.features) {
        toolParts.push(`- ${this.render(feature, variables)}`)
      }
    }

    if (tool.description) {
      toolParts.push(`- **${toolName}**: ${this.render(tool.description, variables)}`)
    }

    return toolParts
  }

  /**
   * Render examples for a tool
   *
   * @param examples - Examples object
   * @param variables - Variables for substitution
   * @returns Rendered examples
   */
  private renderToolExamples(
    examples: MarkerSection['examples'],
    variables: Record<string, boolean | number | string>,
  ): string[] {
    const parts: string[] = []
    if (!examples) {
      return parts
    }

    if (examples.header) {
      parts.push(`\n**${this.render(examples.header, variables)}**`)
    }

    if (examples.items) {
      for (const example of examples.items) {
        parts.push(`- ${this.render(example.title, variables)} - ${this.render(example.description, variables)}`)
      }
    }

    return parts
  }

  /**
   * Render workflow steps for a tool
   *
   * @param workflow - Workflow object with steps
   * @param variables - Variables for substitution
   * @returns Rendered workflow steps
   */
  private renderToolWorkflow(
    workflow: MarkerSection['workflow'],
    variables: Record<string, boolean | number | string>,
  ): string[] {
    const parts: string[] = []
    if (!workflow) {
      return parts
    }

    parts.push(`\n**${this.render(workflow.title, variables)}**:`)
    if (workflow.steps) {
      for (const step of workflow.steps) {
        let stepText = `${step.step}. **${this.render(step.title, variables)}**`
        if (step.description) {
          stepText += ` - ${this.render(step.description, variables)}`
        }

        if (step.items) {
          stepText += '\n' + step.items.map((item: string) => `   - ${this.render(item, variables)}`).join('\n')
        }

        parts.push(stepText)
      }
    }

    return parts
  }
}
