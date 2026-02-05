import path from 'node:path'

import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {IFolderPackService} from '../../../agent/core/interfaces/i-folder-pack-service.js'
import type {FolderPackExecuteOptions, IFolderPackExecutor} from '../../core/interfaces/executor/i-folder-pack-executor.js'

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
  constructor(private readonly folderPackService: IFolderPackService) {}

  public async executeWithAgent(agent: ICipherAgent, options: FolderPackExecuteOptions): Promise<string> {
    const {clientCwd, content, folderPath, taskId} = options

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
      executionContext: {commandType: 'curate'},
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

Analyze this folder and extract knowledge using \`tools.curate()\`. Focus on:

1. **High-level architecture** - How the codebase is organized
2. **Key modules and their purposes** - What each major component does
3. **Configuration patterns** - How the project is configured
4. **Important dependencies** - Key external libraries and their usage
5. **Domain concepts** - Business logic and domain-specific patterns

For each knowledge topic you identify:
- Use \`tools.curate()\` with appropriate operations (ADD, UPDATE, MERGE)
- Create clear, hierarchical paths in the context tree (e.g., "architecture/overview", "modules/authentication")
- Include relevant code references and examples
- Link related topics using the Relations section

**IMPORTANT:**
- Focus on extractable knowledge, not just file listings
- Prioritize architectural insights over implementation details
- Create topics that would help a new developer understand the codebase
- Use MERGE operations when updating existing topics to preserve existing content
`
  }
}
