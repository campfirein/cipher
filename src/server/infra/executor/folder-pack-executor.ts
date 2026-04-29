import {appendFileSync} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {FolderPackResult} from '../../../agent/core/domain/folder-pack/types.js'
import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {IFolderPackService} from '../../../agent/core/interfaces/i-folder-pack-service.js'
import type {
  FolderPackExecuteOptions,
  IFolderPackExecutor,
} from '../../core/interfaces/executor/i-folder-pack-executor.js'

import {BRV_DIR} from '../../constants.js'
import {FileContextTreeManifestService} from '../context-tree/file-context-tree-manifest-service.js'
import {FileContextTreeSnapshotService} from '../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeSummaryService} from '../context-tree/file-context-tree-summary-service.js'
import {diffStates} from '../context-tree/snapshot-diff.js'
import {DreamLockService} from '../dream/dream-lock-service.js'

const LOG_PATH = process.env.BRV_SESSION_LOG
type BackgroundDrainAgent = ICipherAgent & {drainBackgroundWork?: () => Promise<void>}

function folderPackLog(message: string): void {
  if (!LOG_PATH) return
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} [folder-pack-executor] ${message}\n`)
  } catch {
    // ignore — never block on logging
  }
}


/**
 * FolderPackExecutor - Executes folder pack + curate tasks with an injected CipherAgent.
 *
 * This executor:
 * 1. Packs the folder using FolderPackService
 * 2. Stores packed data in sandbox environment as context variable
 * 3. Guides agent to iteratively query and extract knowledge
 * 4. Agent curates extracted pieces using tools.curate()
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on folder pack + curate execution
 * - Uses iterative extraction strategy (inspired by rlm) to avoid token limits
 */
export class FolderPackExecutor implements IFolderPackExecutor {
  constructor(private readonly folderPackService: IFolderPackService) {}

  /** Synchronous wrapper — runs the agent body and awaits Phase 4 inline. */
  public async executeWithAgent(agent: ICipherAgent, options: FolderPackExecuteOptions): Promise<string> {
    const {finalize, response} = await this.runAgentBody(agent, options)
    await finalize()
    return response
  }

  /**
   * Returns the response after the agent body, plus a `finalize` thunk for
   * Phase 4 (snapshot diff → propagateStaleness → manifest rebuild → drain).
   * Caller invokes `finalize` exactly once.
   */
  public async runAgentBody(
    agent: ICipherAgent,
    options: FolderPackExecuteOptions,
  ): Promise<{finalize: () => Promise<void>; response: string}> {
    const {clientCwd, content, folderPath, projectRoot, taskId, worktreeRoot} = options

    // Resolve folder path:
    // - Absent folderPath → default to worktreeRoot (implicit workspace default)
    // - Relative folderPath → resolve from clientCwd (shell semantics)
    // - Absolute folderPath → use as-is
    let absoluteFolderPath: string
    if (!folderPath) {
      absoluteFolderPath = worktreeRoot ?? clientCwd ?? process.cwd()
    } else if (path.isAbsolute(folderPath)) {
      absoluteFolderPath = folderPath
    } else {
      const shellCwd = clientCwd ?? process.cwd()
      absoluteFolderPath = path.resolve(shellCwd, folderPath)
    }

    // Temp file location: use projectRoot where .brv/ lives (accessible to sandbox)
    const tempFileDir = projectRoot ?? clientCwd ?? process.cwd()

    const snapshotService = new FileContextTreeSnapshotService({baseDirectory: tempFileDir})
    let preState: Map<string, import('../../core/domain/entities/context-tree-snapshot.js').FileState> | undefined
    try {
      preState = await snapshotService.getCurrentState(tempFileDir)
    } catch {
      // Fail-open: if snapshot fails, skip summary propagation
    }

    // Pack the folder
    const packResult = await this.folderPackService.pack(absoluteFolderPath, {
      extractDocuments: true,
      extractPdfText: true,
      maxLinesPerFile: 5000, // Limit lines for large files
    })

    // Use iterative extraction strategy (inspired by rlm)
    const response = await this.executeIterative(agent, packResult, content, absoluteFolderPath, taskId, tempFileDir)

    // Build the Phase 4 thunk — captures snapshot/agent state for the detached path.
    const finalize = async (): Promise<void> => {
      await this.runFolderPackPostWork({agent, preState, snapshotService, taskId, tempFileDir})
      await (agent as BackgroundDrainAgent).drainBackgroundWork?.()
    }

    return {finalize, response}
  }

  /**
   * Build iterative extraction prompt with file-based access.
   * Folder data is stored in a temporary file to avoid token limits.
   */
  private buildIterativePromptWithFileAccess(
    userContext: string | undefined,
    folderPath: string,
    tmpFilePath: string,
    fileCount: number,
    totalLines: number,
  ): string {
    const contextSection = userContext?.trim() ? `\n## User Context\n${userContext}\n` : ''

    return `# Iterative Folder Curation Task

You are curating knowledge from a folder: ${folderPath}
${contextSection}
## Folder Overview

- **Total Files**: ${fileCount}
- **Total Lines**: ${totalLines}

## Pre-loaded Data

**IMPORTANT**: Folder data is stored in a temporary file at \`${tmpFilePath}\` in **repomix-style XML format**.

**File Location**: The file is in the current working directory (accessible to code_exec sandbox).

**CRITICAL - Tool Usage**:
- ✅ **USE code_exec ONLY** - All file operations happen inside code_exec
- ✅ **tools.readFile() IS available** inside code_exec - Use it to read the XML file
- ✅ **tools.grep() IS available** inside code_exec - Use it to search the XML file
- ❌ **DO NOT use fs.readFileSync()** - require() is blocked in the sandbox
- ❌ **DO NOT use bash_exec** - use code_exec with tools.readFile/tools.grep instead

**Why tools.readFile() works inside code_exec:**
- The ToolsSDK is pre-injected into the code_exec sandbox as a global \`tools\` object
- You CAN call \`await tools.readFile()\` and \`await tools.grep()\` from inside code_exec
- You CANNOT use \`require('fs')\` because require() is blocked for security
- All async tools methods (readFile, grep, glob, curate) are available inside code_exec

Data structure:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<packed_folder>
  <metadata>
    <file_count>...</file_count>
    <total_lines>...</total_lines>
    ...
  </metadata>
  <directory_structure>
    <![CDATA[
    tree structure here
    ]]>
  </directory_structure>
  <files>
    <file path="src/index.ts" lines="100" size="2048" type="code">
      file content here
    </file>
    <file path="package.json" lines="50" size="1024" type="config">
      file content here
    </file>
    <!-- ... all ${fileCount} files -->
  </files>
  <summary>
    <file_types>code: 10, config: 5, doc: 3</file_types>
  </summary>
</packed_folder>
\`\`\`

## Strategy

Use **code_exec with tools.readFile/tools.grep** to extract knowledge:

1. **Read XML file**: Use \`await tools.readFile('${tmpFilePath}')\` inside code_exec to read the XML
   - Example: \`const fileContent = await tools.readFile('${tmpFilePath}')\`
   - Returns: \`{ content: string, lines: number, truncated: boolean }\`
2. **Search XML file**: Use \`await tools.grep(pattern, options)\` inside code_exec to search
   - Example: \`const matches = await tools.grep('<file[^>]*path=".*README.*">', { path: '${tmpFilePath}' })\`
   - Returns: \`{ matches: [...], totalMatches: number }\`
3. **Process data**: Parse and analyze the XML content using regex/string methods
   - Extract metadata, file lists, specific files, etc.
4. **Curate knowledge**: Use \`await tools.curate(operations)\` inside code_exec
   - Example: \`await tools.curate([{ type: 'ADD', path: 'overview', data: { concept: '...' } }])\`
5. **Process in batches**: Handle 5-10 files at a time to manage output size

**Important**: All tools.* methods are async - always use \`await\`!

## Curate Shape Constraints

- Prefer one concrete knowledge entry per relevant source file when curating a small leaf folder.
- For folders with 3 or fewer relevant source files, keep the number of curated leaf entries at or below the number of curated source files by default.
- Do **NOT** create an extra module/folder "overview" leaf at the bare topic path just because the folder has multiple files.
- Treat bare topic paths as scopes for \`topicContext\`, not as default destinations for standalone knowledge files.
- If you need topic-level framing, provide \`topicContext\` on the operation that creates the topic. The system will create/update \`context.md\` and higher-level summaries separately.
- Only add a standalone overview leaf when the user explicitly asks for it or when there is a distinct cross-file concept that cannot be represented by the per-file entries.

## Common Mistakes to Avoid

**❌ WRONG - Using require() inside code_exec:**
\`\`\`typescript
// This will FAIL - require() is blocked!
const result = await tools.code_exec({
  code: \`
    const fs = require('fs')  // ❌ ERROR: require is not defined
    const data = fs.readFileSync('file.xml', 'utf-8')
    return data
  \`
})
\`\`\`

**✅ CORRECT - Use tools.readFile() inside code_exec:**
\`\`\`typescript
// ✅ tools.readFile() IS available inside code_exec
const result = await tools.code_exec({
  code: \`
    // Read file using pre-injected tools SDK
    const fileContent = await tools.readFile('${tmpFilePath}')
    const xmlData = fileContent.content

    // Process the data
    const metadata = xmlData.match(/<metadata>[\\\\s\\\\S]*?<\\\\/metadata>/)
    return metadata
  \`
})
\`\`\`

## Example: Reading the XML Data

**Note**: Use \`tools.readFile()\` inside code_exec to read files and process data.

\`\`\`typescript
// Everything happens inside ONE code_exec call
const overview = await tools.code_exec({
  code: \`
    // =========================================
    // INSIDE code_exec sandbox:
    // - tools.readFile() IS available
    // - tools.grep() IS available
    // - tools.curate() IS available
    // - require() is NOT available
    // =========================================

    // Step 1: Read the XML file
    const fileContent = await tools.readFile('${tmpFilePath}')
    const xmlData = fileContent.content

    // Step 2: Extract metadata section using regex
    const metadataMatch = xmlData.match(/<metadata>([\\\\s\\\\S]*?)<\\\\/metadata>/)
    if (!metadataMatch) {
      return { error: 'Metadata not found' }
    }

    const metadata = metadataMatch[1]

    // Step 3: Extract specific fields
    const fileCount = metadata.match(/<file_count>(\\\\d+)<\\\\/file_count>/)?.[1]
    const totalLines = metadata.match(/<total_lines>(\\\\d+)<\\\\/total_lines>/)?.[1]
    const fileTypes = xmlData.match(/<file_types>([^<]+)<\\\\/file_types>/)?.[1]

    return {
      fileCount: parseInt(fileCount) || 0,
      totalLines: parseInt(totalLines) || 0,
      fileTypes: fileTypes || 'unknown'
    }
  \`
})

console.log('Folder overview:', overview)
\`\`\`

## Example: Extract README with Full Content Preservation

**IMPORTANT: This example shows VERBATIM preservation - copying the ENTIRE README content, not summarizing it.**

\`\`\`typescript
// Everything happens inside ONE code_exec call
await tools.code_exec({
  code: \`
    // Step 1: Use tools.grep() to find README files
    const grepResult = await tools.grep('<file[^>]*path="[^"]*README[^"]*"', {
      path: '${tmpFilePath}'
    })

    if (!grepResult.matches || grepResult.matches.length === 0) {
      console.log('No README found')
      return { found: false }
    }

    // Step 2: Read the full XML to extract README content
    const fileContent = await tools.readFile('${tmpFilePath}')
    const xmlData = fileContent.content

    // Step 3: Extract README file tag and content (COMPLETE content, not summary)
    const readmeMatch = xmlData.match(/<file[^>]*path="[^"]*README[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/file>/i)
    if (!readmeMatch) {
      return { found: false }
    }

    const fullTag = readmeMatch[0]
    const readmeContent = readmeMatch[1]  // ENTIRE README content
    const pathMatch = fullTag.match(/path="([^"]+)"/)
    const readmePath = pathMatch?.[1] || 'unknown'

    console.log('Found README:', readmePath, '- preserving COMPLETE content')

    // Step 4: Curate with VERBATIM preservation
    // KEY: Store the ENTIRE README in snippets array - DO NOT summarize
    await tools.curate([{
      type: 'UPSERT',
      path: 'documentation/project',
      title: 'Project Overview',
      content: {
        // PRIMARY: Complete README content in snippets (verbatim)
        snippets: [readmeContent],

        // SECONDARY: Extract key metadata if needed
        rawConcept: {
          files: [readmePath],
          timestamp: new Date().toISOString()
        },

        // Relations: Link to related docs if found
        relations: []
      },
      reason: \`Preserving complete README from \${readmePath} - full content captured verbatim\`
    }])

    return {
      found: true,
      path: readmePath,
      contentLength: readmeContent.length,
      preserved: 'complete'
    }
  \`
})
\`\`\`

**Key points demonstrated:**
- ✅ Entire README content copied to \`snippets\` array
- ✅ No summarization or truncation
- ✅ Complete file path preserved in \`rawConcept.files\`
- ✅ Clear reasoning about verbatim preservation
- ❌ NOT creating a summary or "key points" version

## Example: Process Code Files with Complete Preservation

**IMPORTANT: This example shows preserving COMPLETE code files, not just extracting class/function names.**

\`\`\`typescript
// Everything happens inside ONE code_exec call
const tsFiles = await tools.code_exec({
  code: \`
    // Step 1: Use tools.grep() to find TypeScript interface/type files (high value)
    const grepResult = await tools.grep('<file[^>]*path="[^"]*types\\\\.ts"', {
      path: '${tmpFilePath}'
    })

    console.log(\`Found \${grepResult.totalMatches} TypeScript type definition files\`)

    // Step 2: Read the XML file
    const fileContent = await tools.readFile('${tmpFilePath}')
    const xmlData = fileContent.content

    // Step 3: Extract type files (process in batches of 5-10 to manage output)
    const fileRegex = /<file[^>]*path="([^"]*types\\\\.ts)"[^>]*>([\\\\s\\\\S]*?)<\\\\/file>/g
    const files = []
    let match

    while ((match = fileRegex.exec(xmlData)) !== null) {
      files.push({
        path: match[1],
        content: match[2]  // COMPLETE file content
      })

      // Process in batches of 5 to manage output size
      if (files.length >= 5) break
    }

    console.log(\`Processing \${files.length} type definition files - preserving COMPLETE code\`)

    // Step 4: Curate each file with VERBATIM preservation
    for (const file of files) {
      console.log(\`Curating: \${file.path} - full file content\`)

      // Extract structural information (optional metadata)
      const interfaceNames = [...file.content.matchAll(/interface\\s+(\\w+)/g)].map(m => m[1])
      const typeNames = [...file.content.matchAll(/type\\s+(\\w+)/g)].map(m => m[1])
      const enumNames = [...file.content.matchAll(/enum\\s+(\\w+)/g)].map(m => m[1])

      // Create sanitized path for topic (remove special chars)
      const sanitizedPath = file.path
        .replace(/^src\\\\//, '')
        .replace(/\\\\.ts$/, '')
        .replace(/[\\\\/.]/g, '_')

      // Curate with COMPLETE file content
      await tools.curate([{
        type: 'UPSERT',
        path: \`code/types\`,
        title: sanitizedPath,
        content: {
          // PRIMARY: Complete file in snippets (verbatim code)
          snippets: [
            \`\`\`typescript
// File: \${file.path}
\${file.content}
\`\`\`
          ],

          // SECONDARY: Metadata for searchability
          rawConcept: {
            files: [file.path],
            patterns: [
              ...interfaceNames.map(name => ({
                pattern: \`interface \${name}\`,
                description: \`Interface definition for \${name}\`
              })),
              ...typeNames.map(name => ({
                pattern: \`type \${name}\`,
                description: \`Type alias for \${name}\`
              })),
              ...enumNames.map(name => ({
                pattern: \`enum \${name}\`,
                description: \`Enum definition for \${name}\`
              }))
            ].slice(0, 20),  // Limit metadata, but keep FULL code in snippets
            timestamp: new Date().toISOString()
          },

          // TERTIARY: Narrative summary (but code is PRIMARY)
          narrative: {
            structure: \`Defines \${interfaceNames.length} interfaces, \${typeNames.length} type aliases, and \${enumNames.length} enums.\`
          }
        },
        reason: \`Preserving complete type definitions from \${file.path} - full code preserved in snippets\`
      }])
    }

    return {
      processed: files.length,
      total: grepResult.totalMatches,
      preservation: 'complete',
      note: 'All file contents copied verbatim to snippets'
    }
  \`
})

console.log(\`Processed \${tsFiles.processed} of \${tsFiles.total} type files - FULL code preserved\`)
\`\`\`

**Key points demonstrated:**
- ✅ Complete file content in \`snippets\` with \`\`\`typescript\`\`\` formatting
- ✅ File path preserved in comment header
- ✅ Structural metadata extracted but NOT used as replacement for code
- ✅ Process in batches (5-10 files) to manage output, but each file is COMPLETE
- ✅ Sanitized file path used for topic organization
- ❌ NOT extracting just class/function names - preserving FULL implementations

## Example: Get Directory Structure

\`\`\`typescript
// Everything happens inside ONE code_exec call
const tree = await tools.code_exec({
  code: \`
    // Step 1: Read the XML file
    const fileContent = await tools.readFile('${tmpFilePath}')
    const xmlData = fileContent.content

    // Step 2: Extract CDATA section with directory structure
    const treeMatch = xmlData.match(/<directory_structure><!\\\\[CDATA\\\\[([\\\\s\\\\S]*?)\\\\]\\\\]><\\\\/directory_structure>/)

    if (!treeMatch) {
      return null
    }

    const directoryTree = treeMatch[1]

    // Step 3: Curate the directory structure
    await tools.curate([{
      type: 'ADD',
      path: 'project/directory_structure',
      data: {
        concept: 'Project directory structure',
        structure: directoryTree
      }
    }])

    return directoryTree
  \`
})

if (tree) {
  console.log('Directory structure:', tree)
}
\`\`\`

## Content Preservation - CRITICAL INSTRUCTIONS

**FUNDAMENTAL PRINCIPLE: PRESERVE, DON'T SUMMARIZE**

**YOU MUST COPY CONTENT VERBATIM - NOT SUMMARIZE IT**

When curating knowledge from source files, you MUST preserve the exact, complete content. This is NOT a summarization task.

### Required Preservation Approach:

1. **For Documentation/README files:**
   - Copy ENTIRE file content into \`snippets\` array (one snippet = one file)
   - Keep ALL sections, ALL paragraphs, ALL details
   - Preserve exact formatting, code blocks, examples
   - DO NOT summarize or paraphrase

2. **For Code files:**
   - Copy COMPLETE function/class definitions into \`snippets\`
   - Include ALL comments, ALL logic, ALL edge cases
   - Preserve exact variable names, function signatures
   - Keep implementation details - they matter

3. **For Configuration files:**
   - Copy ENTIRE config file content into \`snippets\`
   - Preserve ALL settings, ALL comments, ALL structure
   - Keep exact values and formatting

4. **For Rules/Constraints (from docs or comments):**
   - Use \`narrative.rules\` for exact rule text
   - Copy verbatim from source - no paraphrasing
   - Include ALL constraints, not just "important" ones

5. **For Examples (from docs or code):**
   - Use \`narrative.examples\` for complete examples
   - Include full code blocks with all context
   - Preserve exact formatting and output

6. **For Patterns (validation, regex, etc):**
   - Use \`rawConcept.patterns\` with complete pattern strings
   - Include ALL patterns found, not just samples
   - Add descriptions explaining what each pattern does

7. **For Diagrams (Mermaid, PlantUML, ASCII art):**
   - Use \`narrative.diagrams\` array with {type, content, title?}
   - type: "mermaid" | "plantuml" | "ascii" | "other"
   - Copy ENTIRE diagram content verbatim - character for character
   - NEVER describe a diagram in prose instead of storing the actual diagram
   - Detect: fenced blocks with mermaid/plantuml tags, @startuml/@enduml, box-drawing characters

8. **For Tables:**
   - Copy complete tables with ALL rows into \`narrative.structure\` or \`narrative.highlights\`
   - Preserve column headers and every data row - do not summarize

### What "Preserve" Means:

✅ **CORRECT - Verbatim preservation:**
\`\`\`typescript
content: {
  snippets: [
    \`\`\`markdown
    # Authentication Flow

    The system uses JWT-based authentication with the following steps:

    1. User submits credentials via POST /api/auth/login
    2. Server validates credentials against database
    3. On success, generates JWT with user ID and role
    4. JWT expires after 24 hours
    5. Client stores JWT in httpOnly cookie

    ## Token Structure
    - Header: { "alg": "HS256", "typ": "JWT" }
    - Payload: { "userId": string, "role": string, "exp": number }
    - Signature: HMAC-SHA256(header + payload, secret)

    ## Security Notes
    - Secret key rotated monthly
    - Failed login attempts rate limited (5 per minute)
    - JWT blacklist maintained for logout
    \`\`\`
  ],
  narrative: {
    rules: "Authentication rules:\\n- JWT expires after 24 hours\\n- Secret key rotated monthly\\n- Failed login attempts rate limited (5 per minute)\\n- JWT blacklist maintained for logout"
  }
}
\`\`\`

❌ **WRONG - Summarization:**
\`\`\`typescript
content: {
  snippets: ["JWT authentication with 24-hour expiry"],
  narrative: {
    rules: "Use JWT for auth, rotate secrets regularly"
  }
}
\`\`\`

### Data Structure Usage:

**Primary field for verbatim content:**
- \`snippets: string[]\` - Array of complete file contents or large code sections
  - Each snippet should be a complete, self-contained piece of content
  - Use one snippet per file or per major code section
  - Include full context (imports, dependencies, etc.)

**Secondary fields for structured details:**
- \`narrative.rules\` - Exact rule/constraint text from docs
- \`narrative.examples\` - Complete example code with full context
- \`narrative.highlights\` - Key highlights, capabilities, deliverables, or notable outcomes
- \`narrative.structure\` - Complete structural documentation
- \`narrative.dependencies\` - Full dependency information
- \`rawConcept.patterns\` - All patterns with complete regex/validation strings
- \`rawConcept.files\` - Complete list of related file paths
- \`rawConcept.flow\` - Detailed execution flow description

### Batch Processing Strategy:

Process in batches to manage output size while preserving completeness:
1. **Batch 1 (Priority)**: README, CONTRIBUTING, ARCHITECTURE docs (copy full content)
2. **Batch 2**: Core interfaces/types (copy complete definitions)
3. **Batch 3**: Main implementation files (copy complete functions/classes)
4. **Batch 4**: Configuration files (copy full configs)
5. **Batch 5**: Test files (copy representative test suites)

**Within each batch**: Copy COMPLETE files, don't truncate or summarize

## What to Extract

Extract ALL of the following - COMPLETE and VERBATIM:

1. **Documentation files** - Copy entire README, CONTRIBUTING, ARCHITECTURE files
2. **Architectural patterns** - Copy complete code showing organization and design
3. **Rules & constraints** - Copy exact text from docs/comments/config (no paraphrasing)
4. **Validation patterns** - Copy ALL regex/validation rules with complete patterns
5. **Configuration** - Copy entire config files with all settings
6. **Domain concepts** - Copy complete implementations showing business logic
7. **API definitions** - Copy complete interface/type definitions
8. **Examples** - Copy full example code with all context
9. **Metadata** - Capture authors, versions, dates from files
10. **Diagrams** - Mermaid diagrams, PlantUML, ASCII art flow charts, sequence diagrams (use \`narrative.diagrams\` with type and content - preserve verbatim)
11. **Tables** - Data tables with ALL rows preserved (use \`narrative.structure\` or \`narrative.highlights\`)
12. **Procedures** - Step-by-step instructions, numbered workflows (use \`narrative.rules\`)

## Curation Process

For each knowledge topic:
1. **Read complete files** using tools.readFile() or parse from XML
2. **Copy verbatim content** into appropriate fields (primarily \`snippets\`)
3. **Create UPSERT operations** with complete content (not summaries)
4. **Use hierarchical paths** (e.g., "documentation/architecture", "code/interfaces")
5. **Preserve completeness** - better to split into multiple topics than truncate
6. **Link related topics** using relations field

**REMEMBER: Your goal is to PRESERVE knowledge, not summarize it. Future agents need the COMPLETE, EXACT content to understand and work with this codebase.**

**Start by parsing the XML to understand the folder structure, then systematically extract and process files by type (docs first, then code, then configs).**

## Tips for XML Parsing

**Available tools inside code_exec:**
- \`await tools.readFile(path)\` - Read file contents (returns { content, lines, truncated })
- \`await tools.grep(pattern, options)\` - Search file contents (returns { matches, totalMatches })
- \`await tools.curate(operations)\` - Curate knowledge (operations is an array)
- \`await tools.glob(pattern)\` - Find files by pattern
- \`await tools.listDirectory(path)\` - List directory contents

**Grep patterns for finding files:**
- Find specific files: \`await tools.grep('<file[^>]*path="[^"]*README[^"]*"', { path: '${tmpFilePath}' })\`
- Filter by extension: \`await tools.grep('<file[^>]*path="[^"]*\\\\.ts"', { path: '${tmpFilePath}' })\`
- Search content: \`await tools.grep('function\\\\s+\\\\w+', { path: '${tmpFilePath}' })\`

**Regex patterns for parsing XML:**
- Extract attributes: \`const path = tag.match(/path="([^"]+)"/)?.[1]\`
- Extract file content: \`const content = tag.match(/<file[^>]*>([\\\\s\\\\S]*?)<\\\\/file>/)?.[1]\`
- Extract metadata: \`const metadata = xml.match(/<metadata>([\\\\s\\\\S]*?)<\\\\/metadata>/)?.[1]\`
- Parse multiple files: Use \`fileRegex.exec(xml)\` in a while loop with global flag

**Best practices:**
- Use ONE code_exec call for entire workflow (read → search → process → curate)
- Use \`tools.grep()\` first to check if patterns exist (fast)
- Then use \`tools.readFile()\` to get full content for processing
- Process files in batches (limit to 5-10 files per iteration)
- Always use \`await\` with tools.* methods (they're async)
- NEVER use \`require()\` - it's blocked for security

**Note**: The temporary file will be automatically deleted after curation completes.

---

## Anti-Patterns: What NOT to Do

**❌ WRONG APPROACH - Summarization:**
\`\`\`typescript
// This is INCORRECT - creates summaries instead of preserving content
await tools.curate([{
  type: 'UPSERT',
  path: 'documentation/api',
  title: 'API Guide',
  content: {
    snippets: ['REST API with CRUD operations'],  // ❌ Summary
    narrative: {
      rules: 'Follow REST conventions'  // ❌ Paraphrased
    }
  },
  reason: 'API documentation'
}])
\`\`\`

**✅ CORRECT APPROACH - Verbatim Preservation:**
\`\`\`typescript
// This is CORRECT - preserves complete original content
await tools.curate([{
  type: 'UPSERT',
  path: 'documentation/api',
  title: 'API Guide',
  content: {
    snippets: [
      \`\`\`markdown
      # API Documentation

      ## Endpoints

      ### GET /api/users
      Returns a list of all users.

      **Query Parameters:**
      - \`page\` (optional): Page number (default: 1)
      - \`limit\` (optional): Items per page (default: 20)

      **Response:**
      \\\`\\\`\\\`json
      {
        "users": [
          { "id": 1, "name": "Alice", "email": "alice@example.com" },
          { "id": 2, "name": "Bob", "email": "bob@example.com" }
        ],
        "total": 100,
        "page": 1,
        "limit": 20
      }
      \\\`\\\`\\\`

      ### POST /api/users
      Creates a new user.

      **Request Body:**
      \\\`\\\`\\\`json
      {
        "name": "string",
        "email": "string",
        "password": "string"
      }
      \\\`\\\`\\\`

      **Validation Rules:**
      - Name: Required, 2-50 characters
      - Email: Required, valid email format
      - Password: Required, minimum 8 characters

      **Response:**
      \\\`\\\`\\\`json
      {
        "id": 3,
        "name": "Charlie",
        "email": "charlie@example.com",
        "createdAt": "2025-03-18T10:00:00Z"
      }
      \\\`\\\`\\\`
      \`\`\`
    ],
    narrative: {
      rules: \`API Validation Rules (verbatim):
- Name: Required, 2-50 characters
- Email: Required, valid email format
- Password: Required, minimum 8 characters
- All endpoints require authentication except /api/auth/login
- Rate limit: 100 requests per minute per IP
- Response format: JSON with UTF-8 encoding\`
    }
  },
  reason: 'Preserving complete API documentation with all endpoints, parameters, validation rules, and examples'
}])
\`\`\`

**Common Mistakes:**

1. **❌ Extracting only names/patterns:**
   \`\`\`typescript
   // WRONG: Just listing class names
   patterns: { classes: ['UserService', 'AuthService'] }
   // RIGHT: Include complete class implementations in snippets
   snippets: ['class UserService { ... complete code ... }']
   \`\`\`

2. **❌ Paraphrasing rules:**
   \`\`\`typescript
   // WRONG: "Use proper error handling"
   // RIGHT: Copy exact text from source:
   rules: "All API endpoints must catch exceptions and return standardized error responses with status codes: 400 for validation errors, 401 for authentication errors, 403 for authorization errors, 404 for not found, 500 for server errors."
   \`\`\`

3. **❌ Omitting "less important" details:**
   \`\`\`typescript
   // WRONG: Skipping import statements, type definitions, edge cases
   // RIGHT: Copy EVERYTHING - imports, types, comments, edge cases, all logic
   \`\`\`

4. **❌ Creating abbreviated examples:**
   \`\`\`typescript
   // WRONG: examples: "See code for details"
   // RIGHT: Include the COMPLETE example code
   \`\`\`

**Remember:** Future agents will need COMPLETE information to understand and modify this codebase. Summaries are useless - they need the ACTUAL code and documentation.
`
  }

  /**
   * Execute folder curation using iterative extraction strategy.
   * Pre-loads folder data into REPL environment, then guides agent to iterate and curate.
   * This avoids token limits entirely - data is stored in REPL, not in prompt.
   */
  // eslint-disable-next-line max-params
  private async executeIterative(
    agent: ICipherAgent,
    packResult: FolderPackResult,
    userContext: string | undefined,
    folderPath: string,
    taskId: string,
    projectRoot: string,
  ): Promise<string> {
    // Step 1: Generate repomix-style XML (single string with all file contents)
    const packedXml = this.folderPackService.generateXml(packResult)
    const xmlSizeInMB = (packedXml.length / (1024 * 1024)).toFixed(2)

    folderPackLog(`Generated XML: ${xmlSizeInMB} MB for ${packResult.fileCount} files`)

    // Step 2: Write XML to temporary file (avoids token limits, works with any agent)
    // This approach: file path (~50 bytes) sent to LLM, data stays on disk
    // IMPORTANT: Write to project root (not /tmp) so sandbox can access it
    const tmpFilePath = path.join(projectRoot, `.byterover-curate-${taskId}.xml`)

    folderPackLog(`Writing folder data to temp file: ${tmpFilePath}`)

    try {
      await fs.writeFile(tmpFilePath, packedXml, 'utf8')
      folderPackLog(`Successfully wrote ${xmlSizeInMB} MB to temp file`)
    } catch (error) {
      throw new Error(`Failed to write temp file: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Create per-task session for parallel isolation (own sandbox + history + LLM service)
    const taskSessionId = await agent.createTaskSession(taskId, 'curate', {mapRootEligible: true, userFacing: true})

    // Step 3: Store full instructions as sandbox variable (lazy prompt loading).
    // This saves ~12-15K tokens by keeping the massive instruction set out of the prompt.
    // The LLM reads instructions on-demand via code_exec.
    const fullInstructions = this.buildIterativePromptWithFileAccess(
      userContext,
      folderPath,
      tmpFilePath,
      packResult.fileCount,
      packResult.totalLines,
    )
    // Replace hyphens with underscores: UUIDs have hyphens which are invalid in JS identifiers.
    // The LLM uses underscores when writing code-exec calls — matching curate-executor pattern.
    const taskIdSafe = taskId.replaceAll('-', '_')
    const instructionsVar = `__curate_instructions_${taskIdSafe}`
    agent.setSandboxVariableOnSession(taskSessionId, instructionsVar, fullInstructions)
    const smallFolderFilesVar = `__curate_files_${taskIdSafe}`
    const shouldExposePackedFiles = packResult.files.length > 0 && packResult.files.length <= 10 && packResult.totalCharacters <= 80_000
    if (shouldExposePackedFiles) {
      agent.setSandboxVariableOnSession(taskSessionId, smallFolderFilesVar, packResult.files.map((file) => ({
        content: file.content,
        fileType: file.fileType,
        lineCount: file.lineCount,
        path: file.path,
        size: file.size,
        truncated: file.truncated,
      })))
    }

    // Compact prompt with variable reference and essential metadata
    const contextSection = userContext?.trim() ? `\nUser context: ${userContext}\n` : ''
    const sourceFilePaths = packResult.files.map((file) => file.path)
    const sourceFilesSection = sourceFilePaths.length > 0
      ? `Relevant source files: ${sourceFilePaths.join(', ')} (these paths are relative to the packed folder root; do not prefix them with parent directories like src/auth/)`
      : undefined
    const smallFolderLeafQuota = sourceFilePaths.length > 0 && sourceFilePaths.length <= 3
      ? `Leaf quota: create no more than ${sourceFilePaths.length} curated leaf knowledge files for this folder unless the user explicitly asks for more.`
      : undefined
    const smallFolderQuotaWarning = sourceFilePaths.length > 0 && sourceFilePaths.length <= 3
      ? `A topic-level overview leaf counts toward that quota and is usually incorrect here; keep folder-level framing in topicContext instead.`
      : undefined
    const compactPrompt = [
      `# Folder Curation Task`,
      ``,
      `Folder: ${folderPath} (${packResult.fileCount} files, ${packResult.totalLines} lines)`,
      `Data file: \`${tmpFilePath}\` (repomix-style XML format)`,
      `Full instructions: variable \`${instructionsVar}\``,
      shouldExposePackedFiles
        ? `Relevant files variable: \`${smallFolderFilesVar}\` (array of packed files; for this small folder, prefer using it directly instead of parsing XML with brittle regexes).`
        : undefined,
      contextSection,
      sourceFilesSection,
      `Small-folder rule: for folders with 3 or fewer relevant source files, create at most one leaf knowledge entry per file by default.`,
      smallFolderLeafQuota,
      smallFolderQuotaWarning,
      `Do not create an extra overview leaf at the bare topic path; use topicContext for topic-level framing instead.`,
      `**Start by reading instructions**: Use code_exec to read \`${instructionsVar}.slice(0, 5000)\` for the strategy section, then \`${instructionsVar}.slice(5000, 10000)\` for content rules.`,
      `Use \`tools.readFile()\` and \`tools.grep()\` inside code_exec to process the XML data file.`,
      `Use \`tools.curate()\` to create knowledge topics. Use \`setFinalResult()\` when done.`,
    ]
      .filter(Boolean)
      .join('\n')

    let response: string
    try {
      response = await agent.executeOnSession(taskSessionId, compactPrompt, {
        executionContext: {commandType: 'curate'},
        taskId,
      })
    } finally {
      // Clean up task session (sandbox + history)
      await agent.deleteTaskSession(taskSessionId)

      // Clean up temp file
      folderPackLog(`Cleaning up temp file: ${tmpFilePath}`)
      try {
        await fs.unlink(tmpFilePath)
        folderPackLog(`Temp file cleanup successful`)
      } catch (error) {
        folderPackLog(
          `Temp file cleanup warning (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    return response
  }

  /**
   * Folder-pack Phase 4. Holds the dream lock so a concurrent dream cannot
   * interleave on `_index.md` / `_manifest.json`; skips when the lock is
   * held. Fail-open.
   */
  private async runFolderPackPostWork(ctx: FolderPackPostWorkContext): Promise<void> {
    const {agent, preState, snapshotService, taskId, tempFileDir} = ctx
    if (!preState) return

    const dreamLockService = new DreamLockService({baseDir: path.join(tempFileDir, BRV_DIR)})
    let acquireResult: Awaited<ReturnType<DreamLockService['tryAcquire']>>
    try {
      acquireResult = await dreamLockService.tryAcquire()
    } catch {
      return
    }

    if (!acquireResult.acquired) return

    let succeeded = false
    try {
      const postState = await snapshotService.getCurrentState(tempFileDir)
      const changedPaths = diffStates(preState, postState)
      if (changedPaths.length === 0) {
        succeeded = true
        return
      }

      const summaryService = new FileContextTreeSummaryService()
      const results = await summaryService.propagateStaleness(changedPaths, agent, tempFileDir, taskId)
      if (results.some((result) => result.actionTaken)) {
        const manifestService = new FileContextTreeManifestService({baseDirectory: tempFileDir})
        await manifestService.buildManifest(tempFileDir)
      }

      succeeded = true
    } catch {
      // Fail-open: summary/manifest errors never block curation
    } finally {
      await (succeeded
        ? dreamLockService.release()
        : dreamLockService.rollback(acquireResult.priorMtime)
      ).catch(() => {})
    }
  }
}

type FolderPackPostWorkContext = {
  agent: ICipherAgent
  preState: Map<string, import('../../core/domain/entities/context-tree-snapshot.js').FileState> | undefined
  snapshotService: FileContextTreeSnapshotService
  taskId: string
  tempFileDir: string
}
