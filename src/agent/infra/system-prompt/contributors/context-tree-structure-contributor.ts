import type {Dirent} from 'node:fs'

import fs from 'node:fs/promises'
import path from 'node:path'

import type {ContributorContext, SystemPromptContributor} from '../../../core/domain/system-prompt/types.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Options for context tree structure contributor.
 */
export interface ContextTreeStructureContributorOptions {
  /** Maximum depth for traversing the context tree (default: 5) */
  maxDepth?: number
  /** Maximum number of entries to include (default: 200) */
  maxEntries?: number
  /** Working directory path (default: process.cwd()) */
  workingDirectory?: string
}

/**
 * Context tree structure contributor that injects the .brv/context-tree structure
 * into the system prompt for query and curate commands.
 *
 * This gives the plan agent and sub-agents immediate awareness of available
 * context files before performing any search operations.
 *
 * Based on Anthropic's best practices for context engineering:
 * - Pre-injecting structural context reduces search iterations
 * - Agents can make better decisions about where to look
 * - Reduces token waste from exploratory searches
 */
export class ContextTreeStructureContributor implements SystemPromptContributor {
  public readonly id: string
  public readonly priority: number
  private readonly maxDepth: number
  private readonly maxEntries: number
  private readonly workingDirectory: string

  /**
   * Creates a new context tree structure contributor.
   *
   * @param id - Unique identifier for this contributor
   * @param priority - Execution priority (lower = first)
   * @param options - Configuration options
   */
  public constructor(id: string, priority: number, options: ContextTreeStructureContributorOptions = {}) {
    this.id = id
    this.priority = priority
    this.maxDepth = options.maxDepth ?? 5
    this.maxEntries = options.maxEntries ?? 200
    this.workingDirectory = options.workingDirectory ?? process.cwd()
  }

  /**
   * Generates the context tree structure content.
   *
   * Only generates content for query and curate commands where
   * context tree awareness is important for the agent's operation.
   *
   * @param context - Contributor context with command type
   * @returns Formatted context tree structure, or empty string if not applicable
   */
  public async getContent(context: ContributorContext): Promise<string> {
    // Only inject for query and curate commands
    if (context.commandType !== 'query' && context.commandType !== 'curate') {
      return ''
    }

    const contextTreePath = path.join(this.workingDirectory, '.brv', 'context-tree')

    try {
      await fs.access(contextTreePath)
    } catch {
      return this.buildNoContextTreeMessage()
    }

    const hasSearchKnowledgeTool = context.availableTools?.includes(ToolName.SEARCH_KNOWLEDGE)
    if (hasSearchKnowledgeTool) {
      return this.buildSearchKnowledgeInstructions(contextTreePath)
    }

    return this.buildContextTreeStructure(contextTreePath)
  }

  private async buildContextTreeStructure(contextTreePath: string): Promise<string> {
    const entriesCount = {value: 0}
    const truncatedCount = {value: 0}
    const lines: string[] = []

    await this.traverseContextTree({
      currentDepth: 0,
      dir: contextTreePath,
      entriesCount,
      lines,
      maxDepth: this.maxDepth,
      maxEntries: this.maxEntries,
      relativePath: '',
      truncatedCount,
    })

    if (lines.length === 0) {
      return this.buildEmptyContextTreeMessage()
    }

    // Build the final output
    const parts: string[] = [
      '<context-tree-structure>',
      '## Current Context Tree Structure',
      '',
      'The following is the current hierarchy of curated knowledge in `.brv/context-tree/`:',
      '',
      '```',
      '.brv/context-tree/',
      ...lines,
      '```',
    ]

    if (truncatedCount.value > 0) {
      parts.push('', `[${truncatedCount.value} additional entries not shown]`)
    }

    parts.push(
      '',
      '## Structure Guide',
      '- Each top-level folder is a **domain** (dynamically created based on content)',
      '- Inside domains are **topics** as `.md` files or subfolders with `context.md`',
      '- `context.md` files contain the curated knowledge content',
      '',
      '## Dynamic Domains',
      '- Domains are created dynamically based on the semantics of curated content',
      '- Domain names should be descriptive, use snake_case (e.g., `authentication`, `api_design`)',
      '- Before creating a new domain, check if existing domains could accommodate the content',
      '',
      '## Usage',
      '- **Query commands**: Search ONLY within this context tree structure',
      '- **Curate commands**: Check existing domains/topics before creating new ones',
      '</context-tree-structure>',
    )

    return parts.join('\n')
  }

  /**
   * Builds a message when the context tree is empty.
   */
  private buildEmptyContextTreeMessage(): string {
    return [
      '<context-tree-structure>',
      '## Context Tree Status: Empty',
      '',
      'The context tree at `.brv/context-tree/` exists but contains no curated content yet.',
      '',
      '**For curate commands**: Create new domains and topics dynamically based on content.',
      '- Choose semantically meaningful domain names (e.g., `authentication`, `api_design`, `data_models`)',
      '- Use snake_case format for domain names',
      '**For query commands**: No context is available to search.',
      '</context-tree-structure>',
    ].join('\n')
  }

  /**
   * Builds a message when no context tree exists.
   */
  private buildNoContextTreeMessage(): string {
    return [
      '<context-tree-structure>',
      '## Context Tree Status: Not Initialized',
      '',
      'The `.brv/context-tree/` directory does not exist.',
      'Run `/init` to initialize the ByteRover project and create the context tree.',
      '</context-tree-structure>',
    ].join('\n')
  }

  /**
   * Builds instructions for using the search_knowledge tool.
   * Used when the tool is available to reduce token consumption.
   *
   * @param contextTreePath - Path to the context tree directory
   * @returns Instructions for using search_knowledge tool
   */
  private async buildSearchKnowledgeInstructions(contextTreePath: string): Promise<string> {
    let hasContent = false
    try {
      const entries = await fs.readdir(contextTreePath, {withFileTypes: true})
      hasContent = entries.some((entry) => !entry.name.startsWith('.'))
    } catch {
      hasContent = false
    }

    if (!hasContent) {
      return this.buildEmptyContextTreeMessage()
    }

    return [
      '<context-tree-structure>',
      '## Knowledge Base Available',
      '',
      'Curated knowledge is stored in `.brv/context-tree/`. Use the `search_knowledge` tool to find relevant topics.',
      '',
      '### How to Search',
      '- Use natural language queries: `search_knowledge({ query: "authentication design" })`',
      '- Search is fuzzy and supports partial matches',
      '- Results include file paths, titles, and relevant excerpts',
      '- Use `read_file` on returned paths to view full content',
      '',
      '### Example Queries',
      '- "API design patterns"',
      '- "error handling"',
      '- "database schema"',
      '',
      '### For Curate Commands',
      '- Search existing topics before creating new ones',
      '- Use descriptive domain names (snake_case)',
      '- Avoid duplicating existing knowledge',
      '</context-tree-structure>',
    ].join('\n')
  }

  private async traverseContextTree(options: TraverseOptions): Promise<void> {
    const {currentDepth, dir, entriesCount, lines, maxDepth, maxEntries, relativePath, truncatedCount} = options

    if (currentDepth >= maxDepth) {
      return
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, {withFileTypes: true})
    } catch {
      return
    }

    const filteredEntries = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

    const indent = '  '.repeat(currentDepth + 1)

    for (const entry of filteredEntries) {
      if (entriesCount.value >= maxEntries) {
        truncatedCount.value += filteredEntries.length - filteredEntries.indexOf(entry)
        break
      }

      entriesCount.value++
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`)
        // eslint-disable-next-line no-await-in-loop -- Sequential traversal required for ordered output
        await this.traverseContextTree({
          currentDepth: currentDepth + 1,
          dir: path.join(dir, entry.name),
          entriesCount,
          lines,
          maxDepth,
          maxEntries,
          relativePath: entryRelativePath,
          truncatedCount,
        })
      } else {
        const annotation = entry.name === 'context.md' ? ' (knowledge content)' : ''
        lines.push(`${indent}${entry.name}${annotation}`)
      }
    }
  }
}

/**
 * Options for directory traversal.
 */
interface TraverseOptions {
  /** Current traversal depth */
  currentDepth: number
  /** Current directory path */
  dir: string
  /** Counter for entries added (mutable object) */
  entriesCount: {value: number}
  /** Array to append lines to */
  lines: string[]
  /** Maximum depth to traverse */
  maxDepth: number
  /** Maximum entries to include */
  maxEntries: number
  /** Relative path from context-tree root */
  relativePath: string
  /** Counter for truncated entries (mutable object) */
  truncatedCount: {value: number}
}
