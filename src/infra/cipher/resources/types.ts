/**
 * TypeScript interfaces for YAML prompt structures
 */

/**
 * Base prompt section structure
 */
export interface BasePromptSection {
  content?: string
  example?: string
  example_template?: string
  footer?: string
  header?: string
  items?: string[]
  points?: string[]
  steps?: Array<{
    content?: string
    items?: string[]
    step?: number
    title?: string
  }>
  tool_returns?: string
  tools?: Record<string, ToolDescription>
}

/**
 * Base prompt YAML structure (cipher-agent.yml)
 */
export interface BasePromptYaml {
  prompt_id: string
  sections: Record<string, BasePromptSection>
  version: string
}

/**
 * Marker sections YAML structure (marker-sections.yml)
 */
export interface MarkerSectionsYaml {
  markers: Record<string, MarkerSection>
  prompt_id: string
  version: string
}

export interface MarkerSection {
  additional_tools?: Record<string, {description: string}>
  best_practice?: {
    content: string
    emphasis?: string
  }
  content?: string
  examples?: {
    header: string
    items: Array<{description: string; title: string}>
  }
  header?: string
  intro?: string
  purpose?: string
  section_title: string
  subsections?: Record<string, MarkerSection>
  tools?: Record<string, ToolDescription>
  workflow?: {
    steps: Array<{
      description: string
      items?: string[]
      step: number
      title: string
    }>
    title: string
  }
}

export interface ToolDescription {
  description?: string
  features?: string[]
  header?: string
}

/**
 * Execution modes YAML structure (execution-modes.yml)
 */
export interface ExecutionModesYaml {
  modes: Record<string, ExecutionMode>
  prompt_id: string
  version: string
}

export interface ExecutionMode {
  always_include_in_headless?: boolean
  header?: {
    content?: string
    critical?: boolean
    note?: string
    title: string
  }
  sections?: Record<string, BasePromptSection>
  trigger?: string
}

/**
 * Memory YAML structure (memory.yml)
 */
export interface MemoryYaml {
  formatting: {
    dateFormat: string
    emptyMessage: string
    header: string
    itemTemplate: string
    itemWithBothTemplate: string
    itemWithTagsTemplate: string
    itemWithTimestampTemplate: string
  }
  prompt_id: string
  version: string
}

/**
 * DateTime YAML structure (datetime.yml)
 */
export interface DateTimeYaml {
  format: {
    prefix: string
    template: string
    useXmlTags: boolean
    xmlTag: string
  }
  prompt_id: string
  version: string
}

/**
 * Configuration for PromptResourceLoader
 */
export interface PromptResourceLoaderConfig {
  basePath?: string
  enableCaching?: boolean
}
