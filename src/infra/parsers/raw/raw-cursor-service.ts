/**
 * Cursor IDE Raw Service
 * Consolidates CursorParser + CursorRawParser + Enhanced Bubble Extraction
 * Parses Cursor IDE chat sessions from local storage and workspace data
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  CodeDiff,
  ComposerData,
  ContextInfo,
  CursorBubbleRaw,
  DatabaseQueryResult,
  EnhancedChatBubble,
  FileCheckpoint,
  MessageRequestContext,
  ToolResult,
} from '../../../core/domain/entities/parser.js'

// ============================================================================
// CONSTANTS
// ============================================================================

// Database file paths
const WORKSPACE_DB_FILE = 'state.vscdb'
const GLOBAL_STORAGE_DB_PATH = '../globalStorage/state.vscdb'

// Database query patterns
const COMPOSER_DATA_KEY = 'composer.composerData'
const BUBBLE_ID_KEY_PATTERN = 'bubbleId:%'
const CODE_BLOCK_DIFF_KEY_PATTERN = 'codeBlockDiff:%'
const CHECKPOINT_ID_KEY_PATTERN = 'checkpointId:%'
const MESSAGE_REQUEST_CONTEXT_KEY_PATTERN = 'messageRequestContext:%'
const COMPOSER_DATA_KEY_PATTERN = 'composerData:%'
const FULL_CONVERSATION_HEADERS_PATTERN = '%fullConversationHeadersOnly%'

// Database queries
const SQL_QUERIES = {
  BUBBLE_ROWS: `SELECT key, value FROM cursorDiskKV WHERE key LIKE '${BUBBLE_ID_KEY_PATTERN}'`,
  CHECKPOINT_ROWS: `SELECT key, value FROM cursorDiskKV WHERE key LIKE '${CHECKPOINT_ID_KEY_PATTERN}'`,
  CODE_BLOCK_DIFF_ROWS: `SELECT key, value FROM cursorDiskKV WHERE key LIKE '${CODE_BLOCK_DIFF_KEY_PATTERN}'`,
  COMPOSER_DATA: `SELECT value FROM ItemTable WHERE key = '${COMPOSER_DATA_KEY}'`,
  COMPOSER_ROWS: `SELECT key, value FROM cursorDiskKV WHERE key LIKE '${COMPOSER_DATA_KEY_PATTERN}' AND value LIKE '${FULL_CONVERSATION_HEADERS_PATTERN}'`,
  MESSAGE_REQUEST_CONTEXT_ROWS: `SELECT key, value FROM cursorDiskKV WHERE key LIKE '${MESSAGE_REQUEST_CONTEXT_KEY_PATTERN}'`,
} as const

// Regex patterns
const PATTERNS = {
  CODE_BLOCK_DIFF_KEY: /^codeBlockDiff:([^:]+):/,
} as const

// Magic numbers
const HEADER_TYPE_USER = 1
const FLOAT_PRECISION = 2

// Default values
const DEFAULT_CONTEXT_ID = 'default'
const COMPOSER_ID_PREVIEW_LENGTH = 8
// ============================================================================
// CURSOR RAW SERVICE - Orchestration + File I/O
// ============================================================================

/**
 * Cursor Raw Service
 * Handles extraction of Cursor sessions from both exported files and raw storage
 *
 * Method Organization:
 * - Constructor
 * - Public Methods: parse(), parseFromDirectory()
 * - Private Workspace Methods: loadWorkspaceComposers(), extractChatIdFromCodeBlockDiffKey()
 * - Private Helper Methods (Bubble Extraction): createEnhancedBubble(), and extraction methods
 * - Private Utility Methods: safeParseJSON()
 */
export class CursorRawService {
  private ide: Agent

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  /**
   * Initialize Cursor Raw Service
   *
   * @param ide - The IDE type (Cursor)
   */
  constructor(ide: Agent) {
    this.ide = ide
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Main entry point - Parse Cursor IDE sessions from a custom directory
   *
   * Parses Cursor IDE chat sessions from workspace storage and exports to JSON files.
   * Handles extraction from database files and raw workspace data structures.
   *
   * @param customDir - Path to directory containing Cursor session data
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  async parse(customDir: string): Promise<boolean> {
    try {
      return this.parseFromDirectory(customDir)
    } catch (error) {
      console.error('❌ Error during parsing:', error)
      throw error
    }
  }

  // ============================================================================
  // PRIVATE WORKSPACE METHODS
  // ============================================================================

  /**
   * Parse Cursor IDE sessions from a workspace directory
   *
   * Handles extraction of chat sessions from Cursor's database and storage structures.
   * Processes bubbles, composer data, and other session metadata to create normalized
   * session files. Exports results to workspace-specific output directory.
   *
   * @param customDir - Path to workspace directory containing Cursor session data
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  async parseFromDirectory(customDir: string): Promise<boolean> {
    const outputDir = join(process.cwd(), `.brv/logs/${this.ide}/raw`)

    console.log('🔍 Starting Cursor conversation parsing...')
    console.log(`📁 Custom directory: ${customDir}`)

    const workspacePath = customDir
    const workspaceHash = basename(customDir)
    const workspaceDir = join(outputDir, workspaceHash)

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }

    // Use global database to read all conversations
    const dbPath = join(dirname(customDir), GLOBAL_STORAGE_DB_PATH)

    if (!existsSync(dbPath)) {
      console.error(`❌ Database not found at ${dbPath}`)
      return false
    }

    let db: Database.Database | null = null

    try {
      console.log('\n🔍 Loading workspace-specific composers...')
      const workspaceComposers = this.loadWorkspaceComposers(customDir)

      if (workspaceComposers.size === 0) {
        console.log(
          '⚠️  No workspace-specific composers found. This workspace may not have any conversations.'
        )
      }

      db = new Database(dbPath, { readonly: true })

      // Load all required data from database
      const { bubbleMap, bubbleWorkspaceMap } = this.loadBubbles(db)
      const codeBlockDiffMap = this.loadCodeBlockDiffs(db)
      const checkpointMap = this.loadCheckpoints(db)
      const messageRequestContextMap = this.loadMessageContext(db)

      // Process conversations and export
      const allConversations = this.processConversations(
        db,
        workspacePath,
        workspaceComposers,
        bubbleMap,
        bubbleWorkspaceMap,
        messageRequestContextMap,
        codeBlockDiffMap,
        checkpointMap
      )

      // Export conversations to files
      this.exportConversations(allConversations, workspaceDir, workspaceHash, outputDir)

      console.log(`\n🎉 Complete! Conversations exported to: ${outputDir}`)
      return true
    } catch (error) {
      const err = error as Error
      console.error('❌ Error during parsing:', err)
      throw err
    } finally {
      if (db) {
        db.close()
      }
    }
  }

  /**
   * Create an enhanced chat bubble with all extracted metadata and context
   *
   * Consolidates raw Cursor bubble data with associated tool results, console logs,
   * context information, code diffs, file checkpoints, and code blocks into a single
   * enhanced bubble structure. Extracts optional data from maps if available.
   *
   * @param type - Message type: 'ai' for assistant messages or 'user' for user messages
   * @param text - Raw message text content from the bubble
   * @param timestamp - Unix timestamp in milliseconds when the bubble was created
   * @param bubble - Raw Cursor bubble object containing base message data
   * @param bubbleId - Unique identifier for this bubble, used to look up associated data
   * @param messageContextMap - Optional map of bubble IDs to MessageRequestContext arrays
   * @param codeBlockDiffMap - Optional map of bubble IDs to CodeDiff arrays
   * @param checkpointMap - Optional map of bubble IDs to FileCheckpoint data
   * @returns Enhanced bubble with all extracted metadata and context information
   */
  // eslint-disable-next-line max-params
  private createEnhancedBubble(
    type: 'ai' | 'user',
    text: string,
    timestamp: number,
    bubble: CursorBubbleRaw,
    bubbleId: string,
    messageContextMap?: Record<string, MessageRequestContext[]>,
    codeBlockDiffMap?: Record<string, CodeDiff[]>,
    checkpointMap?: Record<string, FileCheckpoint & { checkpointId: string }>
  ): EnhancedChatBubble {
    const enhanced: EnhancedChatBubble = {
      text,
      timestamp,
      type,
    }

    // Extract tool results
    const toolResults = this.extractToolResults(bubble)
    if (toolResults) {
      enhanced.toolResults = toolResults
    }

    // Extract console logs
    const consoleLogs = this.extractConsoleLogs(bubble)
    if (consoleLogs) {
      enhanced.consoleLogs = consoleLogs
    }

    // Extract context information
    const context = this.extractContextInfo(bubble, messageContextMap, bubbleId)
    if (context) {
      enhanced.context = context
    }

    // Extract code diffs (if this bubble is associated with diffs)
    const codeDiffs = this.extractCodeDiffs(bubbleId, codeBlockDiffMap)
    if (codeDiffs) {
      enhanced.codeDiffs = codeDiffs
    }

    // Extract file checkpoint
    const fileCheckpoint = this.extractFileCheckpoint(bubbleId, checkpointMap)
    if (fileCheckpoint) {
      enhanced.fileCheckpoint = fileCheckpoint
    }

    // Extract code blocks
    const codeBlocks = this.extractCodeBlocks(bubble)
    if (codeBlocks) {
      enhanced.codeBlocks = codeBlocks
    }

    return enhanced
  }

  /**
   * Export parsed conversations to JSON files in workspace-specific output directory
   *
   * Writes each conversation to a separate JSON file named by composer ID, containing
   * bubbles, metadata (id, timestamp, title), workspace hash, and workspace paths.
   * Logs file sizes in KB and exports all conversations with structured formatting.
   *
   * @param allConversations - Array of conversation objects with bubbles and metadata
   * @param workspaceDir - Path to workspace directory for output files
   * @param workspaceHash - Unique hash identifier for the workspace
   * @param _outputDir - Root output directory (used for logging reference)
   */
  private exportConversations(
    allConversations: Array<{ bubbles: EnhancedChatBubble[]; composerId: string; name: string; timestamp: number; workspacePath?: string | string[] }>,
    workspaceDir: string,
    workspaceHash: string,
    _outputDir: string
  ): void {
    console.log('\n💾 Exporting conversations...')
    console.log(`\n  📂 Workspace folder (${workspaceHash})`)

    for (const conversation of allConversations) {
      const filename = `${conversation.composerId}.json`
      const filepath = join(workspaceDir, filename)

      const data = {
        bubbles: conversation.bubbles,
        id: conversation.composerId,
        timestamp: conversation.timestamp,
        title: conversation.name,
        workspaceHash,
        workspacePath: conversation.workspacePath,
      }

      writeFileSync(filepath, JSON.stringify(data, null, 2))
      const fileSize = readFileSync(filepath).length
      const fileSizeKb = (fileSize / 1024).toFixed(FLOAT_PRECISION)
      console.log(`    ✅ ${conversation.name} (${fileSizeKb} KB)`)
    }
  }

  /**
   * Extract the composer ID from a code block diff database key
   *
   * Parses the database key pattern "codeBlockDiff:chatId:diffId" to extract
   * the chat/composer ID using regex pattern matching. Returns null if key format
   * doesn't match expected pattern.
   *
   * @param key - Database key string in format "codeBlockDiff:chatId:diffId"
   * @returns The extracted composer/chat ID, or null if pattern doesn't match
   */
  private extractChatIdFromCodeBlockDiffKey(key: string): null | string {
    const match = key.match(PATTERNS.CODE_BLOCK_DIFF_KEY)
    return match ? match[1] : null
  }

  /**
   * Extract code blocks from a bubble's codeBlocks object
   *
   * Retrieves the code blocks map from a bubble if it exists and is non-empty.
   * Returns undefined if bubble has no code blocks or codeBlocks is not an object.
   *
   * @param bubble - The raw Cursor bubble object to extract code blocks from
   * @returns Object mapping code block IDs to code content, or undefined if none exist
   */
  private extractCodeBlocks(bubble: CursorBubbleRaw): Record<string, string> | undefined {
  if (
    bubble.codeBlocks &&
    typeof bubble.codeBlocks === 'object' &&
    Object.keys(bubble.codeBlocks).length > 0
  ) {
    return bubble.codeBlocks
  }

  return undefined
}

  /**
   * Extract code diffs associated with a specific bubble
   *
   * Looks up code diffs for the given bubble ID in the codeBlockDiffMap.
   * Returns undefined if map is unavailable, bubble has no diffs, or diffs array is empty.
   * Normalizes diff objects to ensure all required fields are present.
   *
   * @param bubbleId - Unique identifier of the bubble to look up diffs for
   * @param codeBlockDiffMap - Optional map of bubble IDs to CodeDiff arrays
   * @returns Array of normalized CodeDiff objects, or undefined if none exist
   */
  private extractCodeDiffs(
    bubbleId: string,
    codeBlockDiffMap?: Record<string, CodeDiff[]>
  ): CodeDiff[] | undefined {
  if (!codeBlockDiffMap) {
    return undefined
  }

  const diffs = codeBlockDiffMap[bubbleId]
  if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
    return undefined
  }

  return diffs.map((diff) => ({
    diffId: diff.diffId || '',
    filePath: diff.filePath,
    newModelDiffWrtV0: diff.newModelDiffWrtV0,
    originalModelDiffWrtV0: diff.originalModelDiffWrtV0,
  }))
}

  /**
   * Extract console logs from a bubble's consoleLogs array
   *
   * Retrieves the console logs array from a bubble if it exists and contains entries.
   * Returns undefined if bubble has no console logs or consoleLogs is not a non-empty array.
   *
   * @param bubble - The raw Cursor bubble object to extract console logs from
   * @returns Array of console log strings, or undefined if none exist
   */
  private extractConsoleLogs(bubble: CursorBubbleRaw): string[] | undefined {
  if (
    bubble.consoleLogs &&
    Array.isArray(bubble.consoleLogs) &&
    bubble.consoleLogs.length > 0
  ) {
    return bubble.consoleLogs
  }

  return undefined
}

  /**
   * Extract context information from both bubble and message context map
   *
   * Consolidates context data from two sources: direct bubble properties
   * (attachedFoldersListDirResults, cursorRules) and message context map data
   * (gitStatus, knowledgeItems, todos, deletedFiles, terminalFiles). Preference
   * given to message context if both sources provide the same field.
   *
   * @param bubble - The raw Cursor bubble object with inline context data
   * @param messageContextMap - Optional map of bubble IDs to MessageRequestContext arrays
   * @param bubbleId - Optional bubble ID to look up context in messageContextMap
   * @returns ContextInfo object with consolidated context, or undefined if no data found
   */
  private extractContextInfo(
    bubble: CursorBubbleRaw,
    messageContextMap?: Record<string, MessageRequestContext[]>,
    bubbleId?: string
  ): ContextInfo | undefined {
  const context: ContextInfo = {}
  let hasData = false

  // From bubble itself
  if (bubble.attachedFoldersListDirResults) {
    context.attachedFoldersListDirResults = bubble.attachedFoldersListDirResults
    hasData = true
  }

  if (bubble.cursorRules && Array.isArray(bubble.cursorRules)) {
    context.cursorRules = bubble.cursorRules
    hasData = true
  }

  // From message request context if available
  if (messageContextMap && bubbleId) {
    const contexts = messageContextMap[bubbleId]
    if (contexts && Array.isArray(contexts) && contexts.length > 0) {
      const msgContext = contexts[0]

      if (msgContext.gitStatusRaw) {
        context.gitStatus = msgContext.gitStatusRaw
        hasData = true
      }

      if (msgContext.attachedFoldersListDirResults) {
        context.attachedFoldersListDirResults = msgContext.attachedFoldersListDirResults
        hasData = true
      }

      if (msgContext.cursorRules) {
        context.cursorRules = msgContext.cursorRules
        hasData = true
      }

      if (msgContext.terminalFiles) {
        context.terminalFiles = msgContext.terminalFiles
        hasData = true
      }

      if (msgContext.knowledgeItems) {
        context.knowledgeItems = msgContext.knowledgeItems
        hasData = true
      }

      if (msgContext.todos) {
        context.todos = msgContext.todos
        hasData = true
      }

      if (msgContext.deletedFiles) {
        context.deletedFiles = msgContext.deletedFiles
        hasData = true
      }
    }
  }

  return hasData ? context : undefined
}

  /**
   * Extract file checkpoint state associated with a bubble
   *
   * Looks up the file checkpoint for a given bubble ID in the checkpoint map.
   * Returns undefined if map is unavailable or bubble has no checkpoint.
   * Normalizes checkpoint object, ensuring array fields (files, newlyCreatedFolders,
   * nonExistentFiles, activeInlineDiffs) are present even if empty.
   *
   * @param bubbleId - Unique identifier of the bubble to look up checkpoint for
   * @param checkpointMap - Optional map of bubble IDs to FileCheckpoint objects
   * @returns Normalized FileCheckpoint object, or undefined if none exists
   */
  private extractFileCheckpoint(
    bubbleId: string,
    checkpointMap?: Record<string, FileCheckpoint & { checkpointId: string }>
  ): FileCheckpoint | undefined {
  if (!checkpointMap || !checkpointMap[bubbleId]) {
    return undefined
  }

  const checkpoint = checkpointMap[bubbleId]

  return {
    activeInlineDiffs: checkpoint.activeInlineDiffs || [],
    files: checkpoint.files || [],
    inlineDiffNewlyCreatedResources: checkpoint.inlineDiffNewlyCreatedResources,
    newlyCreatedFolders: checkpoint.newlyCreatedFolders || [],
    nonExistentFiles: checkpoint.nonExistentFiles || [],
  }
}

  /**
   * Extract tool execution results from a bubble's toolFormerData object
   *
   * Parses tool execution metadata from the bubble, including tool name, status,
   * parameters, results, and additional context. Returns undefined if bubble has no
   * toolFormerData or is missing required fields (name, status). Safely parses JSON
   * strings for params, rawArgs, and result fields that may contain serialized data.
   *
   * @param bubble - The raw Cursor bubble object containing tool execution data
   * @returns ToolResult object with execution details, or undefined if no valid tool data
   */
  private extractToolResults(bubble: CursorBubbleRaw): ToolResult | undefined {
  if (!bubble.toolFormerData || typeof bubble.toolFormerData !== 'object') {
    return undefined
  }

  const tool = bubble.toolFormerData

  // Only return if it has the required fields for a valid tool result
  if (tool.name && tool.status) {
    return {
      additionalData: tool.additionalData as Record<string, unknown> | undefined,
      modelCallId: (tool.modelCallId as string) || '',
      name: tool.name as string,
      params: (this.safeParseJSON(tool.params) as Record<string, unknown> | string) || {},
      rawArgs: (this.safeParseJSON(tool.rawArgs) as Record<string, unknown> | string) || {},
      result: (this.safeParseJSON(tool.result) as Record<string, unknown> | string) || {},
      status: tool.status as string,
      tool: (tool.tool as number) || 0,
      toolCallId: (tool.toolCallId as string) || '',
      toolIndex: (tool.toolIndex as number) || 0,
    }
  }

  return undefined
}

  /**
   * Load all bubbles from the database and build indexed maps
   *
   * Queries the database for all bubble entries matching the bubble ID pattern,
   * parses JSON values, and builds maps for fast lookups. Creates bubble-to-workspace
   * mapping and tracks unique workspace hashes. Skips invalid or unparseable entries.
   *
   * @param db - Better-sqlite3 database instance with cursorDiskKV table
   * @returns Object containing: bubbleMap (ID -> bubble), bubbleWorkspaceMap (ID -> workspace hash), uniqueWorkspaces set
   */
  private loadBubbles(db: Database.Database): { bubbleMap: Record<string, CursorBubbleRaw>; bubbleWorkspaceMap: Record<string, string>; uniqueWorkspaces: Set<string> } {
    console.log('\n📝 Loading bubbles...')
    const bubbleMap: Record<string, CursorBubbleRaw> = {}
    const bubbleWorkspaceMap: Record<string, string> = {}
    const bubblesByWorkspace: Record<string, Set<string>> = {}

    const bubbleRows = db.prepare(SQL_QUERIES.BUBBLE_ROWS).all()

    for (const rowUntyped of bubbleRows) {
      const row = rowUntyped as { key: string; value: string }
      const keyParts = row.key.split(':')
      const bubbleWorkspaceHash = keyParts[1]
      const bubbleId = keyParts[2]
      try {
        const bubble = JSON.parse(row.value)
        if (!bubble || typeof bubble !== 'object') continue

        bubbleMap[bubbleId] = bubble
        bubbleWorkspaceMap[bubbleId] = bubbleWorkspaceHash

        if (!bubblesByWorkspace[bubbleWorkspaceHash]) {
          bubblesByWorkspace[bubbleWorkspaceHash] = new Set()
        }

        bubblesByWorkspace[bubbleWorkspaceHash].add(bubbleId)
      } catch {
        // Skip parse errors
      }
    }

    const uniqueWorkspaces = new Set(Object.values(bubbleWorkspaceMap))
    console.log(
      `✅ Loaded ${Object.keys(bubbleMap).length} total bubbles from ${uniqueWorkspaces.size} workspace(s)`
    )

    return { bubbleMap, bubbleWorkspaceMap, uniqueWorkspaces }
  }

  /**
   * Load all file checkpoints from the database and build indexed map
   *
   * Queries the database for all checkpoint entries matching the checkpoint ID pattern,
   * parses JSON values, and builds a map for fast lookups. Handles multiple checkpoints
   * per composer by keeping the latest based on checkpoint ID string comparison.
   * Skips invalid or unparseable entries.
   *
   * @param db - Better-sqlite3 database instance with cursorDiskKV table
   * @returns Map of composer IDs to their FileCheckpoint objects with checkpointId field
   */
  private loadCheckpoints(db: Database.Database): Record<string, FileCheckpoint & { checkpointId: string }> {
    console.log('📝 Loading checkpoints...')
    const checkpointMap: Record<string, FileCheckpoint & { checkpointId: string }> = {}
    const checkpointRows = db.prepare(SQL_QUERIES.CHECKPOINT_ROWS).all()

    for (const rowUntyped of checkpointRows) {
      const row = rowUntyped as { key: string; value: string }
      const parts = row.key.split(':')
      if (parts.length < 3) continue

      const composerId = parts[1]
      const checkpointId = parts[2]
      try {
        const checkpoint = JSON.parse(row.value)
        if (!checkpointMap[composerId] || checkpointId > (checkpointMap[composerId].checkpointId || '')) {
          checkpointMap[composerId] = {
            ...checkpoint,
            checkpointId,
          }
        }
      } catch {
        // Skip parse errors
      }
    }

    console.log(`✅ Loaded checkpoints`)
    return checkpointMap
  }

  /**
   * Load all code block diffs from the database and build indexed map
   *
   * Queries the database for all code block diff entries, extracts chat/composer IDs
   * from keys, parses JSON values, and groups diffs by composer ID. Each diff includes
   * the diffId extracted from the database key. Skips invalid or unparseable entries.
   *
   * @param db - Better-sqlite3 database instance with cursorDiskKV table
   * @returns Map of composer IDs to arrays of CodeDiff objects with diffId field
   */
  private loadCodeBlockDiffs(db: Database.Database): Record<string, CodeDiff[]> {
    console.log('📝 Loading code diffs...')
    const codeBlockDiffMap: Record<string, CodeDiff[]> = {}
    const codeBlockDiffRows = db.prepare(SQL_QUERIES.CODE_BLOCK_DIFF_ROWS).all()

    for (const rowUntyped of codeBlockDiffRows) {
      const row = rowUntyped as { key: string; value: string }
      const chatId = this.extractChatIdFromCodeBlockDiffKey(row.key)
      if (!chatId) continue
      try {
        const codeBlockDiff = JSON.parse(row.value)
        if (!codeBlockDiffMap[chatId]) codeBlockDiffMap[chatId] = []
        codeBlockDiffMap[chatId].push({
          ...codeBlockDiff,
          diffId: row.key.split(':')[2],
        })
      } catch {
        // Skip parse errors
      }
    }

    console.log(`✅ Loaded ${Object.keys(codeBlockDiffMap).length} diff groups`)
    return codeBlockDiffMap
  }

  /**
   * Load all message request context from the database and build indexed map
   *
   * Queries the database for all message request context entries, parses JSON values,
   * and groups contexts by composer ID. Extracts context ID from key parts or uses
   * default context ID if not present. Skips invalid or unparseable entries and keys
   * with insufficient format.
   *
   * @param db - Better-sqlite3 database instance with cursorDiskKV table
   * @returns Map of composer IDs to arrays of MessageRequestContext objects with contextId field
   */
  private loadMessageContext(db: Database.Database): Record<string, MessageRequestContext[]> {
    console.log('📝 Loading message context...')
    const messageRequestContextMap: Record<string, MessageRequestContext[]> = {}
    const messageRequestContextRows = db.prepare(SQL_QUERIES.MESSAGE_REQUEST_CONTEXT_ROWS).all()

    for (const rowUntyped of messageRequestContextRows) {
      const row = rowUntyped as { key: string; value: string }
      const parts = row.key.split(':')
      if (parts.length < 2) continue

      const composerId = parts[1]
      const contextId = parts.length >= 3 ? parts[2] : DEFAULT_CONTEXT_ID
      try {
        const context = JSON.parse(row.value)
        if (!messageRequestContextMap[composerId]) messageRequestContextMap[composerId] = []
        messageRequestContextMap[composerId].push({
          ...context,
          bubbleId: context.bubbleId,
          contextId,
        })
      } catch {
        // Skip parse errors
      }
    }

    console.log(`✅ Loaded context for ${Object.keys(messageRequestContextMap).length} composers`)
    return messageRequestContextMap
  }

  /**
   * Load composer IDs that are specific to a workspace
   *
   * Reads the workspace's state.vscdb database, extracts composer data from the
   * ItemTable, and builds a set of composer IDs that belong to this workspace.
   * Returns empty set if database or composer data is not found. Logs warnings
   * if database or data is unavailable.
   *
   * @param workspacePath - Path to the workspace directory containing state.vscdb
   * @returns Set of composer IDs that belong to this workspace
   */
  private loadWorkspaceComposers(workspacePath: string): Set<string> {
    const workspaceComposers = new Set<string>()

    try {
      const workspaceDbPath = join(workspacePath, WORKSPACE_DB_FILE)

      if (!existsSync(workspaceDbPath)) {
        console.log(`⚠️  Workspace database not found at ${workspaceDbPath}`)
        return workspaceComposers
      }

      const wsDb = new Database(workspaceDbPath, { readonly: true })
      try {
        const result = wsDb
          .prepare(SQL_QUERIES.COMPOSER_DATA)
          .get() as DatabaseQueryResult | undefined

        if (!result || !result.value) {
          console.log('⚠️  No composer data found in workspace ItemTable')
          return workspaceComposers
        }

        const composerData = JSON.parse(result.value.toString()) as { allComposers?: ComposerData[] }
        const allComposers = composerData.allComposers || []

        for (const composer of allComposers) {
          const composerData = composer as ComposerData
          if (composerData.composerId) {
            workspaceComposers.add(composerData.composerId)
          }
        }

        console.log(
          `✅ Loaded ${workspaceComposers.size} workspace-specific composers from ItemTable`
        )
      } finally {
        wsDb.close()
      }
    } catch (error) {
      console.log(
        `⚠️  Could not load workspace composers:`,
        error instanceof Error ? error.message : String(error)
      )
    }

    return workspaceComposers
  }

  /**
   * Log parsing statistics for processed conversations
   *
   * Outputs summary information about how many conversations were successfully parsed
   * and how many were skipped due to various conditions (not in workspace, no extractable
   * bubbles, no headers). Omits zero-count skip reasons from output for cleaner logging.
   *
   * @param parsed - Number of successfully parsed conversations
   * @param skippedNotInWorkspace - Number of conversations skipped (not in this workspace)
   * @param skippedNoBubbles - Number of conversations skipped (no extractable bubbles)
   * @param skippedNoHeaders - Number of conversations skipped (no conversation headers)
   */
  private logConversationStats(parsed: number, skippedNotInWorkspace: number, skippedNoBubbles: number, skippedNoHeaders: number): void {
    console.log(`\n✅ Parsed ${parsed} conversations`)
    if (skippedNotInWorkspace > 0) {
      console.log(`⚠️  Skipped ${skippedNotInWorkspace} conversations not in this workspace`)
    }

    if (skippedNoBubbles > 0) {
      console.log(`⚠️  Skipped ${skippedNoBubbles} conversations with no extractable bubbles`)
    }

    if (skippedNoHeaders > 0) {
      console.log(`⚠️  Skipped ${skippedNoHeaders} conversations with no headers`)
    }
  }

  /**
   * Process conversation headers and create enhanced bubbles from raw data
   *
   * Iterates through conversation headers, looks up corresponding bubbles by ID,
   * creates enhanced bubbles with extracted metadata (tool results, context, diffs, etc).
   * Filters out empty bubbles (no text, tool results, or console logs). Tracks unique
   * workspaces that bubbles belong to.
   *
   * @param conversationHeaders - Array of header objects containing bubble IDs and types
   * @param bubbleMap - Map of bubble IDs to raw CursorBubbleRaw objects
   * @param bubbleWorkspaceMap - Map of bubble IDs to their workspace hashes
   * @param messageRequestContextMap - Map of bubble IDs to MessageRequestContext arrays
   * @param codeBlockDiffMap - Map of bubble IDs to CodeDiff arrays
   * @param checkpointMap - Map of bubble IDs to FileCheckpoint objects
   * @returns Object with bubbles array and usedWorkspaces set
   */
  // eslint-disable-next-line max-params
  private processBubbleHeaders(
    conversationHeaders: Array<Record<string, unknown>>,
    bubbleMap: Record<string, CursorBubbleRaw>,
    bubbleWorkspaceMap: Record<string, string>,
    messageRequestContextMap: Record<string, MessageRequestContext[]>,
    codeBlockDiffMap: Record<string, CodeDiff[]>,
    checkpointMap: Record<string, FileCheckpoint & { checkpointId: string }>
  ): { bubbles: EnhancedChatBubble[]; usedWorkspaces: Set<string> } {
    const bubbles: EnhancedChatBubble[] = []
    const usedWorkspaces = new Set<string>()

    for (const header of conversationHeaders) {
      const bubbleId = header.bubbleId as string
      const bubble = bubbleMap?.[bubbleId]
      if (!bubble) continue

      const bubbleWs = bubbleWorkspaceMap[bubbleId]
      if (bubbleWs) {
        usedWorkspaces.add(bubbleWs)
      }

      const isUser = header.type === HEADER_TYPE_USER
      const messageType = isUser ? 'user' : 'ai'
      const text = bubble.text?.trim() || ''

      const enhancedBubble = this.createEnhancedBubble(
        messageType,
        text,
        bubble.timestamp || Date.now(),
        bubble,
        bubbleId,
        messageRequestContextMap,
        codeBlockDiffMap,
        checkpointMap
      )

      if (enhancedBubble.text.trim() || enhancedBubble.toolResults || enhancedBubble.consoleLogs) {
        bubbles.push(enhancedBubble)
      }
    }

    return { bubbles, usedWorkspaces }
  }

  /**
   * Load and process all conversations from the database for a specific workspace
   *
   * Queries the database for all composer conversation data, filters to workspace-specific
   * composers, parses each conversation's headers, creates enhanced bubbles, and returns
   * conversation objects with metadata. Tracks and logs statistics on parsed vs skipped
   * conversations (not in workspace, no headers, no extractable bubbles).
   *
   * @param db - Better-sqlite3 database instance
   * @param workspacePath - Path to the workspace directory
   * @param workspaceComposers - Set of composer IDs belonging to this workspace
   * @param bubbleMap - Map of bubble IDs to raw CursorBubbleRaw objects
   * @param bubbleWorkspaceMap - Map of bubble IDs to their workspace hashes
   * @param messageRequestContextMap - Map of bubble IDs to MessageRequestContext arrays
   * @param codeBlockDiffMap - Map of bubble IDs to CodeDiff arrays
   * @param checkpointMap - Map of bubble IDs to FileCheckpoint objects
   * @returns Array of conversation objects with bubbles and metadata
   */
  // eslint-disable-next-line max-params
  private processConversations(
    db: Database.Database,
    workspacePath: string,
    workspaceComposers: Set<string>,
    bubbleMap: Record<string, CursorBubbleRaw>,
    bubbleWorkspaceMap: Record<string, string>,
    messageRequestContextMap: Record<string, MessageRequestContext[]>,
    codeBlockDiffMap: Record<string, CodeDiff[]>,
    checkpointMap: Record<string, FileCheckpoint & { checkpointId: string }>
  ): Array<{ bubbles: EnhancedChatBubble[]; composerId: string; name: string; timestamp: number; workspacePath?: string | string[] }> {
    console.log('📝 Loading conversations...')
    const composerRows = db.prepare(SQL_QUERIES.COMPOSER_ROWS).all()

    console.log(`📊 Found ${composerRows.length} conversations`)

    let skippedNoHeaders = 0
    let skippedNoBubbles = 0
    let skippedNotInWorkspace = 0

    const allConversations: Array<{ bubbles: EnhancedChatBubble[]; composerId: string; name: string; timestamp: number; workspacePath?: string | string[] }> = []

    for (const rowUntyped of composerRows) {
      const row = rowUntyped as { key: string; value: string }
      const composerId = row.key.split(':')[1]

      if (!workspaceComposers.has(composerId)) {
        skippedNotInWorkspace++
        continue
      }

      try {
        const composerData = JSON.parse(row.value)
        const conversationHeaders = composerData.fullConversationHeadersOnly || []

        if (conversationHeaders.length === 0) {
          skippedNoHeaders++
          continue
        }

        const { bubbles } = this.processBubbleHeaders(
          conversationHeaders,
          bubbleMap,
          bubbleWorkspaceMap,
          messageRequestContextMap,
          codeBlockDiffMap,
          checkpointMap
        )

        if (bubbles.length > 0) {
          const conversationName = composerData.name || `Conversation ${composerId.slice(0, COMPOSER_ID_PREVIEW_LENGTH)}`

          allConversations.push({
            bubbles,
            composerId,
            name: conversationName,
            timestamp: composerData.lastUpdatedAt || composerData.createdAt,
            workspacePath,
          })
        } else {
          skippedNoBubbles++
        }
      } catch (error) {
        console.error(`⚠️  Error parsing conversation ${composerId}:`, error)
      }
    }

    this.logConversationStats(allConversations.length, skippedNotInWorkspace, skippedNoBubbles, skippedNoHeaders)
    return allConversations
  }

// ============================================================================
// PRIVATE UTILITY METHODS
// ============================================================================

  /**
   * Safely parse JSON strings with graceful fallback to original value
   *
   * Attempts to parse a string as JSON. If parsing succeeds, returns the parsed object.
   * If parsing fails or value is not a string, returns the original value unchanged.
   * Used for fields that may contain either pre-parsed objects or JSON strings.
   *
   * @param value - Value to parse, may be string, object, or any other type
   * @returns Parsed JSON object if string input, original value otherwise
   */
  private safeParseJSON(value: unknown): unknown {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value // Return original string if parsing fails
      }
    }

    return value // Already parsed or not a string
  }
}
