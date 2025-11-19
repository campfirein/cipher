/**
 * Copilot Clean Service
 * Transforms GitHub Copilot raw parsed data to clean normalized format
 */

import { promises as fs } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  CleanCopilotProcessResult,
  RawCopilotParsedRequest,
  RawCopilotRawSession,
  RawCopilotResponseItem,
  RawCopilotToolCallRound,
  RawCopilotVariableData,
  WorkspaceInfo,
} from '../../../core/domain/entities/parser.js'
import { ICleanParserService } from '../../../core/interfaces/parser/i-clean-parser-service.js'
import {normalizeClaudeSession} from './shared.js'
/**
 * Copilot Clean Service
 * Transforms GitHub Copilot raw parsed sessions to clean normalized format
 */
export class CopilotCleanService implements ICleanParserService {
  private ide: Agent

  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Parse and transform GitHub Copilot raw sessions to clean normalized format
   *
   * Reads Copilot raw session files organized by workspace, transforms them using
   * Claude-compatible format, and writes the normalized sessions to the output directory.
   * Each session is transformed through Copilot-to-Claude conversion then normalized.
   *
   * @param rawDir - Absolute path to the directory containing raw Copilot session files organized by workspace
   * @returns Promise that resolves to true if parsing succeeded, false otherwise
   */
  /* eslint-disable no-await-in-loop */
  async parse(rawDir: string): Promise<boolean> {
    const outputDir = pathJoin(process.cwd(), `.brv/logs/${this.ide}/clean`)

    console.log('🔍 Starting GitHub Copilot clean transformation...')
    console.log(`📁 Raw directory: ${rawDir}`)

    try {
      await mkdir(outputDir, { recursive: true })

      // Read raw sessions organized by workspace
      const workspaceDirs = await readdir(rawDir)

      let totalSessions = 0

      for (const workspaceDir of workspaceDirs) {
        const workspacePath = pathJoin(rawDir, workspaceDir)
        const stat = await readdir(workspacePath)

        // Create workspace output directory
        const wsOutputDir = pathJoin(outputDir, workspaceDir)
        await mkdir(wsOutputDir, { recursive: true })

        for (const file of stat) {
          if (!file.endsWith('.json') || file === 'summary.json') continue

          try {
            const content = await readFile(pathJoin(workspacePath, file), 'utf8')
            const session = JSON.parse(content) as RawCopilotRawSession

            // Transform Copilot format to Claude format
            const claudeFormatted = this.transformCopilotToClaudeFormat(session)

            // Normalize the session using shared transformer
            const normalized = normalizeClaudeSession(claudeFormatted, 'Copilot')

            // Write normalized session
            const outputFile = pathJoin(wsOutputDir, file)
            await writeFile(outputFile, JSON.stringify(normalized, null, 2))
            totalSessions++
            console.log(`    ✅ ${session.title}`)
          } catch (error) {
            console.warn(`⚠️  Failed to transform ${file}:`, error instanceof Error ? error.message : String(error))
          }
        }
      }

      console.log(`\n🎉 Copilot clean transformation complete! ${totalSessions} sessions saved to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during transformation:', error)
      return false
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Process Copilot data by analyzing and transforming valid workspaces
   *
   * Performs complete workspace analysis and transformation:
   * 1. Analyzes all workspaces to identify valid Copilot sessions
   * 2. Logs workspace validity analysis with session counts
   * 3. Copies and transforms valid workspaces to Claude-compatible format
   * Returns statistics about processed workspaces.
   *
   * @param rawResultsDir - Absolute path to raw Copilot results directory
   * @param cleanResultsDir - Absolute path to clean results output directory
   * @returns Promise with statistics: total workspaces, valid count, invalid count
   */
  /* eslint-disable no-await-in-loop */
  public async processCopilotData(
    rawResultsDir: string,
    cleanResultsDir: string
  ): Promise<CleanCopilotProcessResult> {
    console.log('\n📊 Analyzing Copilot workspaces...')

    const workspaces = await this.analyzeCopilotWorkspaces(rawResultsDir)
    let validCount = 0
    let invalidCount = 0

    console.log('\n📋 Copilot Workspace Analysis:')
    for (const [name, info] of workspaces.entries()) {
      if (info.isValid) {
        console.log(`  ✅ ${name}`)
        console.log(`     ${info.reason}`)
        validCount++
      } else {
        console.log(`  ❌ ${name}`)
        console.log(`     ${info.reason}`)
        invalidCount++
      }
    }

    // Copy valid workspaces
    console.log(`\n💾 Copying and transforming ${validCount} valid workspace(s) to clean_results...`)
    const cleanCopilotDir = pathJoin(cleanResultsDir, 'copilot')
    await fs.mkdir(cleanCopilotDir, { recursive: true })

    for (const [name, info] of workspaces.entries()) {
      if (info.isValid) {
        await this.copyValidCopilotWorkspace(name, rawResultsDir, cleanCopilotDir)
      }
    }

    return {
      invalid: invalidCount,
      total: workspaces.size,
      valid: validCount,
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Analyze Copilot workspaces to identify valid vs invalid sessions
   *
   * Scans workspace directories and validates each by checking for valid Copilot session
   * files. A workspace is considered valid if it contains at least one session file with
   * non-empty requests array. Returns a map of workspace information including validity
   * status, valid/empty session counts, and reason.
   *
   * @param copilotResultsDir - Absolute path to directory containing Copilot workspace subdirectories
   * @returns Promise that resolves to a map of workspace names to WorkspaceInfo objects
   */
  /* eslint-disable no-await-in-loop */
  private async analyzeCopilotWorkspaces(
    copilotResultsDir: string
  ): Promise<Map<string, WorkspaceInfo>> {
    const workspaceMap = new Map<string, WorkspaceInfo>()

    try {
      const entries = await fs.readdir(copilotResultsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'summary.json') {
          continue
        }

        const workspacePath = pathJoin(copilotResultsDir, entry.name)
        const files = await fs.readdir(workspacePath)
        const jsonFiles = files.filter((f) => f.endsWith('.json') && f !== 'summary.json')

        const validCount = await this.countValidCopilotSessions(workspacePath, jsonFiles)
        const hasValidSessions = validCount > 0

        workspaceMap.set(entry.name, {
          isValid: hasValidSessions,
          name: entry.name,
          path: workspacePath,
          reason: hasValidSessions
            ? `${validCount} valid session(s), ${jsonFiles.length - validCount} empty session(s)`
            : `No valid sessions found (${jsonFiles.length} empty files)`,
          type: 'copilot',
        })
      }
    } catch (error) {
      console.error('Error analyzing Copilot workspaces:', error)
    }

    return workspaceMap
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Build session metadata from Copilot session data
   *
   * Extracts and formats metadata from Copilot session including message/request counts,
   * usernames, session ID, and duration. Combines data from transformed messages and
   * original session metadata.
   *
   * @param transformedMessages - Array of transformed message objects
   * @param copilotSession - Original Copilot session object with metadata
   * @returns Metadata object with counts, usernames, session ID, and duration
   */
  private buildSessionMetadata(
    transformedMessages: Array<Record<string, unknown>>,
    copilotSession: RawCopilotRawSession
  ): Record<string, unknown> {
    const {metadata} = copilotSession

    return {
      messageCount: transformedMessages.length,
      requestCount: metadata?.requestCount,
      requesterUsername: metadata?.requesterUsername,
      responderUsername: metadata?.responderUsername,
      sessionId: metadata?.sessionId,
      totalDuration: metadata?.totalDuration,
    }
  }


  /**
   * Copy and transform valid Copilot workspace to clean results directory
   *
   * Processes all JSON files in a valid workspace, transforming valid Copilot sessions
   * (those with non-empty requests) to Claude-compatible format. Applies full normalization
   * pipeline and splits multi-content assistant messages. Creates target directory as needed.
   *
   * @param workspaceHash - Hash identifier of the workspace directory
   * @param sourceDir - Absolute path to parent directory containing workspace directories
   * @param targetDir - Absolute path to clean results output directory
   * @returns Promise that resolves when all files are processed and copied
   */
  /* eslint-disable no-await-in-loop */
  private async copyValidCopilotWorkspace(
    workspaceHash: string,
    sourceDir: string,
    targetDir: string
  ): Promise<void> {
    const sourcePath = pathJoin(sourceDir, workspaceHash)
    const targetPath = pathJoin(targetDir, workspaceHash)

    // Create target directory
    await fs.mkdir(targetPath, { recursive: true })

    // Read all files
    const files = await fs.readdir(sourcePath)

    // Copy and transform valid JSON files
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'summary.json') {
        try {
          const sourceFile = pathJoin(sourcePath, file)
          const content = await fs.readFile(sourceFile, 'utf8')
          const data = JSON.parse(content) as RawCopilotRawSession

          // Only copy if has valid requests (messages field from raw parser)
          if (data.requests && data.requests.length > 0) {
            // Transform to Claude format from requests structure
            const transformed = this.transformCopilotToClaudeFormat(data)

            // Apply full normalization pipeline (content standardization, turn_id assignment, etc.)
            const normalized = normalizeClaudeSession(transformed, 'Copilot')

            // Split assistant messages with multiple content blocks into separate messages
            const split = this.splitAllCopilotContent(normalized as unknown as Record<string, unknown>)

            const targetFile = pathJoin(targetPath, file)
            await fs.writeFile(targetFile, JSON.stringify(split, null, 2))
          }
        } catch {
          // Skip files that can't be processed
        }
      }
    }

    console.log(`✅ Copied and transformed ${workspaceHash} to clean_results`)
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Count valid Copilot session files in a workspace directory
   *
   * Iterates through provided JSON files and counts how many are valid Copilot sessions
   * (have non-empty requests array). Used for workspace analysis and validation.
   *
   * @param workspacePath - Absolute path to the workspace directory
   * @param jsonFiles - Array of JSON filename strings to validate
   * @returns Promise that resolves to the count of valid Copilot session files
   */
  /* eslint-disable no-await-in-loop */
  private async countValidCopilotSessions(workspacePath: string, jsonFiles: string[]): Promise<number> {
    let validCount = 0
    for (const file of jsonFiles) {
      const isValid = await this.isValidCopilotSession(pathJoin(workspacePath, file))
      if (isValid) {
        validCount++
      }
    }

    return validCount
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Create assistant message from Copilot request response
   *
   * Extracts response data from Copilot request and builds an assistant message:
   * 1. Converts response text to thinking block
   * 2. Extracts tool invocations with arguments and results
   * Returns null if no content could be extracted.
   *
   * @param req - Copilot request object with response and result data
   * @returns Assistant message object with content array, or null if no valid content
   */
  private createAssistantMessageFromRequest(req: RawCopilotParsedRequest): null | Record<string, unknown> {
    if (!req.response || !Array.isArray(req.response)) {
      return null
    }

    const assistantContent: Array<Record<string, unknown>> = []

    // Extract main text response and convert to thinking block
    const responseText = this.extractCopilotResponseText(req.response)
    if (responseText) {
      assistantContent.push({
        thinking: responseText,
        type: 'thinking',
      })
    }

    // Extract tool invocations with their arguments and results
    const {result} = req
    const resultMetadata = result?.metadata
    const toolCallRounds = resultMetadata?.toolCallRounds
    const toolCallResults = resultMetadata?.toolCallResults
    const toolInvocations = this.extractCopilotToolInvocations(
      req.response,
      toolCallRounds,
      toolCallResults
    )
    assistantContent.push(...toolInvocations)

    if (assistantContent.length === 0) {
      return null
    }

    return {
      content: assistantContent,
      timestamp: new Date().toISOString(),
      type: 'assistant',
    }
  }

  /**
   * Create user message from Copilot request
   *
   * Extracts user message text from request and builds a user message object.
   * Includes attachments from variableData if present (file references).
   * Returns null if no message text found.
   *
   * @param req - Copilot request object with message and variableData
   * @returns User message object with text content and optional attachments, or null
   */
  private createUserMessageFromRequest(req: RawCopilotParsedRequest): null | Record<string, unknown> {
    if (!req.message) {
      return null
    }

    const {message} = req
    const userMessage: Record<string, unknown> = {
      content: [
        {
          text: typeof message.text === 'string' ? message.text : '',
          type: 'text',
        },
      ],
      timestamp: new Date().toISOString(),
      type: 'user',
    }

    // Add attachments if present
    const attachments = this.extractCopilotAttachments(req.variableData || { variables: [] })
    if (attachments.length > 0) {
      userMessage.attachments = attachments
    }

    return userMessage
  }

  /**
   * Extract file attachments from Copilot variableData
   *
   * Scans the variableData object for file variables and extracts their names.
   * File variables are identified by having kind='file'. Returns an array of filenames
   * representing files attached to a Copilot request/message.
   *
   * @param variableData - Object containing variables array with file references
   * @returns Array of file attachment names extracted from variables
   */
  private extractCopilotAttachments(variableData: RawCopilotVariableData): string[] {
    const attachments: string[] = []

    if (variableData?.variables && Array.isArray(variableData.variables)) {
      for (const variable of variableData.variables) {
        if (variable.kind === 'file' && typeof variable.name === 'string') {
          attachments.push(variable.name)
        }
      }
    }

    return attachments
  }

  /**
   * Extract text content from Copilot response items
   *
   * Filters response items to find main text responses (items without kind or with kind='unknown')
   * and concatenates their values into a single text string. Skips prepareToolInvocation items
   * which are used for tool setup rather than content. Returns trimmed concatenated text.
   *
   * @param responseItems - Array of response item objects with kind and value properties
   * @returns Concatenated text content from non-tool response items
   */
  private extractCopilotResponseText(responseItems: RawCopilotResponseItem[]): string {
    const textParts: string[] = []

    for (const item of responseItems) {
      // Skip prepareToolInvocation items
      if (item.kind === 'prepareToolInvocation') {
        continue
      }

      // Extract text from unknown kind items (main responses)
      if ((!item.kind || item.kind === 'unknown') && item.value && typeof item.value === 'string') {
          textParts.push(item.value)
        }
    }

    return textParts.join(' ').trim()
  }

  /**
   * Extract tool invocations and their results from Copilot response
   *
   * Processes toolInvocationSerialized response items and matches them with detailed tool calls
   * from toolCallRounds and results from toolCallResults. Constructs tool_use content blocks
   * with parsed arguments (converting from string JSON when needed) and associated output/results.
   * Matches sequentially: the nth toolInvocationSerialized corresponds to the nth toolCall
   * in the collected toolCalls array.
   *
   * @param responseItems - Array of response item objects, filtering for toolInvocationSerialized kind
   * @param toolCallRounds - Optional array of tool call rounds, each containing toolCalls array
   * @param toolCallResults - Optional map of tool results keyed by tool call ID
   * @returns Array of tool_use content blocks with input arguments and output results
   */
  private extractCopilotToolInvocations(
    responseItems: RawCopilotResponseItem[],
    toolCallRounds?: RawCopilotToolCallRound[],
    toolCallResults?: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const toolInvocations: Array<Record<string, unknown>> = []

    // First, collect all toolCalls from all rounds in order
    const allToolCalls: Array<{ arguments?: Record<string, unknown> | string; id: string }> = []
    if (toolCallRounds && Array.isArray(toolCallRounds)) {
      for (const round of toolCallRounds) {
        if (round.toolCalls && Array.isArray(round.toolCalls)) {
          allToolCalls.push(...round.toolCalls)
        }
      }
    }

    // Track position in allToolCalls - match toolInvocationSerialized items sequentially to toolCalls
    let toolCallIndex = 0

    for (const item of responseItems) {
      if (item.kind !== 'toolInvocationSerialized' || !item.toolCallId || !item.toolId) {
        continue
      }

      const toolUse: Record<string, unknown> = {
        id: item.toolCallId,
        input: (item.invocationMessage as Record<string, unknown>)?.value || '',
        name: item.toolId,
        type: 'tool_use',
      }

      // Try to find detailed tool call arguments from toolCallRounds
      // Match sequentially - the nth toolInvocationSerialized corresponds to the nth toolCall
      if (toolCallIndex < allToolCalls.length) {
        const toolCall = allToolCalls[toolCallIndex]

        try {
          const args =
            typeof toolCall.arguments === 'string'
              ? JSON.parse(toolCall.arguments)
              : toolCall.arguments
          toolUse.input = args as Record<string, unknown>
          // eslint-disable-next-line camelcase
          toolUse.tool_use_id = toolCall.id

          // Try to find result in toolCallResults
          if (toolCallResults && typeof toolCall.id === 'string' && toolCall.id in toolCallResults) {
            const result = toolCallResults[toolCall.id] as Record<string, unknown>
            const textContent = this.extractToolResultContent(result)

            // Always create output property for consistency, even if content is empty
            toolUse.output = {
              content: textContent || '',
              type: 'tool_result',
            }
          }
        } catch {
          // Keep original input if parsing fails
        }
      }

      toolCallIndex++
      toolInvocations.push(toolUse)
    }

    return toolInvocations
  }

  /**
   * Extract valid workspace path from object's baseUri property
   *
   * Checks if an object contains a baseUri with a valid path property. Path must be
   * a string starting with '/' and must not have been seen before (checked against seenPaths set).
   * Adds valid paths to seenPaths to prevent duplicates. Used for workspace path extraction
   * from nested Copilot session data structures.
   *
   * @param obj - Object that may contain baseUri.path structure
   * @param seenPaths - Set of previously seen paths to avoid duplicates
   * @returns Valid path string if found and not previously seen, null otherwise
   */
  private extractPathFromBaseUri(obj: unknown, seenPaths: Set<string>): null | string {
    if (!obj || typeof obj !== 'object') {
      return null
    }

    const objRecord = obj as Record<string, unknown>
    if (!objRecord.baseUri || typeof objRecord.baseUri !== 'object' || objRecord.baseUri === null) {
      return null
    }

    const baseUri = objRecord.baseUri as Record<string, unknown>
    if (!baseUri.path || typeof baseUri.path !== 'string') {
      return null
    }

    const {path} = baseUri as {path: string}
    if (path.startsWith('/') && !seenPaths.has(path)) {
      seenPaths.add(path)
      return path
    }

    return null
  }

  /**
   * Extract readable text from deeply nested VS Code/Copilot object structures
   *
   * Recursively traverses nested object trees commonly found in Copilot tool results,
   * extracting all text values from nodes. Handles multiple text source patterns:
   * 1. Direct text property on nodes
   * 2. String values in value property
   * 3. Nested structures in children array
   * 4. Nested structures in node property
   * Returns concatenated text from all found sources, trimmed.
   *
   * @param obj - Nested object structure to traverse (may be object, array, or primitive)
   * @returns Concatenated text content extracted from all nested text sources
   */
  private extractTextFromNestedObject(obj: unknown): string {
    const textParts: string[] = []

    function traverse(node: unknown): void {
      if (!node) return

      // If this is an array, traverse each element
      if (Array.isArray(node)) {
        for (const item of node) {
          traverse(item)
        }

        return
      }

      if (typeof node !== 'object') return

      const nodeRecord = node as Record<string, unknown>

      // If node has a text property, add it
      if (typeof nodeRecord.text === 'string' && nodeRecord.text) {
        textParts.push(nodeRecord.text)
      }

      // If node has value, traverse it
      if (nodeRecord.value) {
        if (typeof nodeRecord.value === 'string') {
          textParts.push(nodeRecord.value)
        } else if (typeof nodeRecord.value === 'object') {
          traverse(nodeRecord.value)
        }
      }

      // If node has children array, traverse each child
      if (Array.isArray(nodeRecord.children)) {
        for (const child of nodeRecord.children) {
          traverse(child)
        }
      }

      // If node has node property (nested structure)
      if (nodeRecord.node && typeof nodeRecord.node === 'object') {
        traverse(nodeRecord.node)
      }
    }

    traverse(obj)
    return textParts.join('').trim()
  }

  /**
   * Extract human-readable text content from Copilot tool result objects
   *
   * Handles multiple result format patterns commonly returned by Copilot tools:
   * 1. Array-based content: Simple string extraction from value properties (e.g., run_in_terminal)
   * 2. Array-based content: Fallback to nested object extraction (e.g., copilot_readFile)
   * 3. Object-based content: Traverses nested structures for text values
   * Prefers simple extraction if content found, falls back to complex nested traversal.
   * Used to extract readable output from tool invocation results.
   *
   * @param result - Tool result object with content property (array, object, or nested structure)
   * @returns Extracted text content from the result, empty string if no content found
   */
  private extractToolResultContent(result: Record<string, unknown>): string {
    let textContent = ''

    // Try to extract from array-based content
    if (result.content && Array.isArray(result.content)) {
      // First try simple string value extraction (e.g., run_in_terminal results)
      const simpleExtracted = result.content
        .map((c: unknown) => {
          const cRecord = c as Record<string, unknown>
          if (typeof cRecord.value === 'string') {
            return cRecord.value
          }

          if (typeof c === 'string') {
            return c
          }

          return null
        })
        .filter((v: null | string) => v !== null)
        .join('\n')

      // If simple extraction found content, use it; otherwise try nested object extraction (e.g., copilot_readFile results)
      textContent = simpleExtracted || this.extractTextFromNestedObject(result.content)
    }
    // Try to extract from plain nested object structure
    else if (result.content && typeof result.content === 'object') {
      textContent = this.extractTextFromNestedObject(result.content)
    }
    // If result itself is a nested object with content, extract from it
    else if (typeof result === 'object' && !Array.isArray(result)) {
      textContent = this.extractTextFromNestedObject(result)
    }

    return textContent
  }

  /**
   * Extract workspace path from Copilot session data structures
   *
   * Recursively searches through all properties and nested objects in a Copilot session
   * to find workspace paths. Looks for baseUri.path patterns which contain absolute paths
   * starting with '/'. Returns the first valid path found. Uses a seenPaths set internally
   * to avoid returning duplicate paths if multiple workspace paths exist.
   *
   * @param copilotSession - Copilot session object containing nested data structures with baseUri patterns
   * @returns First valid workspace path found (absolute path starting with '/'), or null if not found
   */
  private extractWorkspacePathFromCopilot(copilotSession: RawCopilotRawSession): null | string {
    const seenPaths = new Set<string>()

    const traverse = (obj: unknown): null | string => {
      if (!obj || typeof obj !== 'object') {
        return null
      }

      const objRecord = obj as Record<string, unknown>

      // Check current object's baseUri
      const pathFromBaseUri = this.extractPathFromBaseUri(obj, seenPaths)
      if (pathFromBaseUri) {
        return pathFromBaseUri
      }

      // Traverse all properties
      for (const key of Object.keys(objRecord)) {
        const value = objRecord[key]
        if (typeof value === 'object' && value !== null) {
          const result = traverse(value)
          if (result) {
            return result
          }
        }
      }

      return null
    }

    return traverse(copilotSession)
  }

  /**
   * Validate if a Copilot session file contains valid session data
   *
   * Reads and parses a JSON file, checking if it contains a non-empty requests array.
   * A session is considered valid if requests field exists and contains at least one request.
   * Used during workspace analysis to identify which session files have meaningful data.
   * Returns false silently if file cannot be read or parsed.
   *
   * @param filePath - Absolute path to JSON session file
   * @returns Promise resolving to true if file contains valid requests, false otherwise
   */
  private async isValidCopilotSession(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(content)
      return data.requests && Array.isArray(data.requests) && data.requests.length > 0
    } catch {
      return false
    }
  }

  /**
   * Normalize workspace paths from Copilot session to standard array format
   *
   * Ensures workspace paths are always returned as a string array. Handles multiple input formats:
   * 1. Already-array workspace paths (monorepo with multiple paths)
   * 2. String workspace paths (single workspace)
   * 3. Extracted workspace paths via deep extraction if not found in top-level workspacePath property
   * Returns empty array if no workspace paths found. Provides fallback extraction mechanism for
   * complex Copilot session structures where workspace info is nested.
   *
   * @param copilotSession - Copilot session object which may have workspacePath property or nested paths
   * @returns Array of workspace paths (may be empty if no paths found)
   */
  private normalizeWorkspacePaths(copilotSession: RawCopilotRawSession): string[] {
    const workspacePath = copilotSession.workspacePath || this.extractWorkspacePathFromCopilot(copilotSession) || ''

    // Handle array workspace paths (monorepo)
    if (Array.isArray(workspacePath)) {
      return workspacePath as string[]
    }

    if (typeof workspacePath === 'string' && workspacePath) {
      return [workspacePath]
    }

    return []
  }

  /**
   * Split all messages in a session that have multiple content blocks
   *
   * Copilot assistant messages often contain multiple content blocks (thinking + tool_use)
   * in a single message. This function splits such messages into separate messages, one per
   * content block, to create a cleaner, more normalized message sequence.
   *
   * Processing logic:
   * - User messages: Preserved as-is (no splitting)
   * - Assistant messages with single content block: Preserved as-is
   * - Assistant messages with multiple content blocks: Split into separate messages,
   *   one per content block, each with the same timestamp
   *
   * After splitting, recalculates turn_id for all messages to maintain proper sequential
   * numbering (1, 2, 3, ...). This ensures the message sequence remains valid after the
   * splitting transformation.
   *
   * @param session - Copilot session object with messages array to be split
   * @returns New session object with split messages and recalculated turn_ids
   */
  private splitAllCopilotContent(session: Record<string, unknown>): Record<string, unknown> {
    const split: Array<Record<string, unknown>> = []

    if (!Array.isArray(session.messages)) {
      return session
    }

    for (const message of session.messages) {
      const msg = message as Record<string, unknown>
      if (msg.type === 'assistant' && Array.isArray(msg.content) && msg.content.length > 1) {
        // Split this message - each content block becomes its own message
        const splitMessages = msg.content.map((block: unknown) => ({
          content: [block],
          timestamp: msg.timestamp,
          type: 'assistant',
        }))
        split.push(...splitMessages)
      } else {
        // Keep as-is (user messages or assistant messages with single content block)
        split.push(msg)
      }
    }

    // Recalculate turn_id for all messages to maintain proper sequence
    const withTurnIds = split.map((msg: Record<string, unknown>, index: number) => ({
      ...msg,
      // eslint-disable-next-line camelcase
      turn_id: index + 1,
    }))

    return {
      ...session,
      messages: withTurnIds,
    }
  }

  /**
   * Transform Copilot session to match Claude format
   * Uses the requests array which contains detailed conversation structure
   */
  private transformCopilotToClaudeFormat(copilotSession: RawCopilotRawSession): Record<string, unknown> {
    const transformedMessages: Array<Record<string, unknown>> = []
    const requests = copilotSession.requests || []

    for (const request of requests) {
      const req = request

      // Create user message from request
      const userMessage = this.createUserMessageFromRequest(req)
      if (userMessage) {
        transformedMessages.push(userMessage)
      }

      // Create assistant message from response
      const assistantMessage = this.createAssistantMessageFromRequest(req)
      if (assistantMessage) {
        transformedMessages.push(assistantMessage)
      }
    }

    const workspacePaths = this.normalizeWorkspacePaths(copilotSession)
    const sessionMetadata = this.buildSessionMetadata(transformedMessages, copilotSession)

    return {
      id: copilotSession.id,
      messages: transformedMessages,
      metadata: sessionMetadata,
      timestamp: copilotSession.timestamp,
      title: copilotSession.title,
      type: 'Copilot',
      workspacePaths,
    }
  }
}


