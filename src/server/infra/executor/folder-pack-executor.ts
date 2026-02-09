import path from 'node:path'

import type { ICipherAgent } from '../../../agent/core/interfaces/i-cipher-agent.js'
import type { IFolderPackService } from '../../../agent/core/interfaces/i-folder-pack-service.js'
import type { FolderPackExecuteOptions, IFolderPackExecutor } from '../../core/interfaces/executor/i-folder-pack-executor.js'

/**
 * FolderPackExecutor - Executes folder pack + curate tasks with an injected CipherAgent.
 *
 * This executor:
 * 1. Packs the folder using FolderPackService
 * 2. Generates XML from the pack result
 * 3. Builds a prompt for the agent to analyze and curate the folder
 * 4. Executes with the agent
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on folder pack + curate execution
 */
export class FolderPackExecutor implements IFolderPackExecutor {
  constructor(private readonly folderPackService: IFolderPackService) { }

  public async executeWithAgent(agent: ICipherAgent, options: FolderPackExecuteOptions): Promise<string> {
    const { clientCwd, content, folderPath, taskId } = options

    // Resolve folder path
    const basePath = clientCwd ?? process.cwd()
    const absoluteFolderPath = path.isAbsolute(folderPath) ? folderPath : path.resolve(basePath, folderPath)

    // Pack the folder
    const packResult = await this.folderPackService.pack(absoluteFolderPath, {
      extractDocuments: true,
      extractPdfText: true,
      maxLinesPerFile: 5000, // Limit lines for large files
    })

    // Generate XML from pack result
    const xml = this.folderPackService.generateXml(packResult)

    // Build prompt for the agent
    const prompt = this.buildAnalysisPrompt(xml, content, packResult.fileCount, absoluteFolderPath)

    // Execute with curate commandType
    const response = await agent.execute(prompt, {
      executionContext: { commandType: 'curate' },
      taskId,
    })

    return response
  }

  /**
   * Build the analysis prompt for the agent.
   */
  private buildAnalysisPrompt(xml: string, context: string | undefined, fileCount: number, folderPath: string): string {
    const contextSection = context?.trim() ? `\n## User Context\n${context}\n` : ''

    return `# Folder Analysis Task

You are analyzing a packed folder containing ${fileCount} files from: ${folderPath}
${contextSection}
## Packed Folder Content

<packed_folder_xml>
${xml}
</packed_folder_xml>

## Instructions

Analyze this folder and extract knowledge using \`tools.curate()\`. Your goal is to **preserve details**, not summarize.

**CONTENT PRESERVATION (CRITICAL):**
- Preserve EXACT wording for rules, constraints, and configuration values - DO NOT paraphrase
- Capture ALL items in enumerations and lists - do not omit any
- Store regex patterns, validation patterns verbatim in \`rawConcept.patterns\` array
- Capture author/source attribution in \`rawConcept.author\` field
- Use \`narrative.rules\` for exact rule text - preserve verbatim, not summaries
- Use \`narrative.examples\` for concrete examples and use cases with specific details
- Detect and preserve ALL diagrams (Mermaid fenced blocks, PlantUML, ASCII art) in \`narrative.diagrams\` array with correct type
- Preserve ALL tables with every row - do not summarize table data
- Store step-by-step procedures verbatim in \`narrative.rules\`
- Completeness over conciseness - err on the side of verbosity

**WHAT TO EXTRACT:**
1. **Architectural patterns** - How the codebase is organized, key design decisions
2. **Rules and constraints** - Exact verbatim text from docs, comments, config files (use narrative.rules)
3. **Validation patterns** - Regex, validation rules with exact patterns (use rawConcept.patterns)
4. **Configuration** - Settings, constants, feature flags with exact values
5. **Domain concepts** - Business logic and domain-specific patterns
6. **Metadata** - Authors, versions, dates, sources (use rawConcept.author)
7. **Diagrams** - Mermaid diagrams, PlantUML, ASCII art flow charts, sequence diagrams (use narrative.diagrams with type and content)
8. **Tables** - Data tables with all rows preserved (use narrative.structure or narrative.features)
9. **API signatures** - Function signatures, interface definitions, type declarations (use narrative.structure + snippets)
10. **Procedures** - Step-by-step instructions, numbered workflows (use narrative.rules)

**For each knowledge topic:**
- Use \`tools.curate()\` with UPSERT operations (preferred - auto-detects ADD vs UPDATE)
- Create clear, hierarchical paths (e.g., "rules/code_quality", "patterns/validation")
- Include ALL details from the source - if there are 16 patterns, store all 16, not 3-5 examples
- Preserve exact text for rules - if a rule says "Make changes file by file and give me a chance to spot mistakes", store that exact text in narrative.rules
- Link related topics using the Relations section
- Use the new fields (author, patterns, rules, examples) when applicable

**PRIORITIZATION:**
- Completeness over conciseness
- Exact content over summaries
- All items over representative samples
- Preservation over interpretation
`
  }
}
