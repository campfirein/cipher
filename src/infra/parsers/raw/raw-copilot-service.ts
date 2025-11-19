/**
 * GitHub Copilot Raw Service
 * Consolidates CopilotParser + CopilotRawParser
 * Extracts and exports GitHub Copilot chat sessions
 */

import Database from 'better-sqlite3'
import { readFileSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { basename, join } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  RawCopilotContentBlock,
  RawCopilotDatabaseRow,
  RawCopilotParsedRequest,
  RawCopilotRawMessage,
  RawCopilotRawSession,
  RawCopilotRequestData,
  RawCopilotResponseBlock,
  RawCopilotResponseItem,
  RawCopilotSessionFileData,
  RawCopilotSessionMetadata,
  RawCopilotVariableData,
} from '../../../core/domain/entities/parser.js'
import { IRawParserService } from '../../../core/interfaces/parser/i-raw-parser-service.js'

// ============================================================================
// Constants
// ============================================================================

const VS_CODE_STORAGE_PATH = 'Library/Application Support/Code/User/workspaceStorage'
const DEFAULT_HOME_DIR = '~'
const SCM_REPOSITORIES_KEY = 'scm:view:visibleRepositories'
const FILE_URI_PATTERN = /file:\/\/(.+)$/
const TITLE_MAX_LENGTH = 150
const TITLE_TRUNCATE_LENGTH = 100
const TITLE_ELLIPSIS = '...'
const UNKNOWN_USERNAME = 'Unknown'
const GITHUB_COPILOT = 'GitHub Copilot'
const UNKNOWN_LOCATION = 'unknown'
const DEFAULT_SESSION_TITLE = 'Copilot Chat Session'
const UNKNOWN_WORKSPACE = 'unknown-workspace'
const UNKNOWN_KIND = 'unknown'

// ============================================================================
// Copilot Raw Parser Service
// ============================================================================

/**
 * Copilot Raw Parser Service class
 * Handles extraction of GitHub Copilot sessions from VS Code workspace storage
 */
export class CopilotRawService implements IRawParserService {
  private ide: Agent
  private workspaceStoragePath: string

  // ========================================================================
  // Constructor
  // ========================================================================

  /**
   * Initialize Copilot Raw Service
   *
   * Detects and initializes the VS Code workspace storage path where
   * GitHub Copilot chat session databases are stored.
   *
   * @param ide - The IDE type (Github Copilot)
   */
  constructor(ide: Agent) {
    this.ide = ide
    this.workspaceStoragePath = this.detectWorkspacePath()
  }

  // ========================================================================
  // Public Methods
  // ========================================================================

  /**
   * Main entry point - Parse and export GitHub Copilot sessions
   *
   * Parses GitHub Copilot sessions from custom directory, extracts session data,
   * and exports to JSON files organized by workspace. Creates summary file with
   * aggregate statistics across all sessions. Returns success status.
   *
   * @param customDir - Path to directory containing GitHub Copilot session data
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  async parse(customDir: string): Promise<boolean> {
    const outputDir = join(process.cwd(), `.brv/logs/${this.ide}/raw`)

    console.log('🔍 Starting GitHub Copilot conversation parsing...')

    try {
      // Parse all sessions from custom directory
      const sessions = await this.parseFromDirectory(customDir)

      if (sessions.length === 0) {
        console.log('ℹ️  No GitHub Copilot sessions found')
        return true
      }

      console.log(`\n✅ Found ${sessions.length} Copilot sessions`)

      // Organize sessions by workspace hash
      const sessionsByWorkspace: Record<
        string,
        Array<typeof sessions[0] & { workspaceHash: string }>
      > = {}

      for (const session of sessions) {
        const workspaceHash = session.metadata.workspace?.path || UNKNOWN_WORKSPACE

        if (!sessionsByWorkspace[workspaceHash]) {
          sessionsByWorkspace[workspaceHash] = []
        }

        sessionsByWorkspace[workspaceHash].push({
          ...session,
          workspaceHash,
        })
      }

      console.log(`\n📁 Organized into ${Object.keys(sessionsByWorkspace).length} workspace(s)`)

      // Export sessions organized by workspace
      console.log('\n💾 Exporting sessions by workspace...')

      for (const [workspaceHash, workspaceSessions] of Object.entries(sessionsByWorkspace)) {
        const workspaceDir = join(outputDir, workspaceHash)

        if (!fs.existsSync(workspaceDir)) {
          fs.mkdirSync(workspaceDir, { recursive: true })
        }

        console.log(`\n  📂 Workspace (${workspaceHash})`)

        // Extract workspace path from first session (should be consistent)
        const workspacePath = workspaceSessions[0]?.workspacePath || 'Unknown Workspace'

        // Export session files for this workspace
        for (const session of workspaceSessions) {
          const filename = `${session.id}.json`
          const filepath = join(workspaceDir, filename)

          const sessionData = {
            ...session,
            workspacePath: session.workspacePath || workspacePath
          }

          writeFileSync(filepath, JSON.stringify(sessionData, null, 2))
          const fileSize = readFileSync(filepath).length
          const fileSizeKb = (fileSize / 1024).toFixed(1)
          console.log(`    ✅ ${session.title} (${fileSizeKb} KB)`)
        }
      }

      console.log(`\n🎉 Copilot export complete! Sessions exported to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during parsing:', error)
      throw error
    }
  }

  /**
   * Calculate total session duration from request timings
   *
   * Aggregates the totalElapsed time from all requests' result.timings field.
   * Returns total duration in milliseconds across all request/response cycles.
   *
   * @param requests - Array of Copilot request data with timing information
   * @returns Total elapsed time in milliseconds
   */
  private calculateTotalDuration(requests: RawCopilotRequestData[]): number {
    let totalTime = 0

    for (const request of requests) {
      if (request.result?.timings?.totalElapsed) {
        totalTime += request.result.timings.totalElapsed
      }
    }

    return totalTime
  }

  // ========================================================================
  // Private Methods - Initialization
  // ========================================================================

  /**
   * Convert Copilot requests to normalized messages
   *
   * Transforms request/response pairs into alternating user and assistant messages.
   * Each request becomes a user message (with attachments), and the response becomes
   * an assistant message. Handles multiple response blocks and normalizes content format.
   *
   * @param requests - Array of Copilot request data to convert
   * @returns Array of normalized RawCopilotRawMessage objects
   */
  private convertRequestsToMessages(requests: RawCopilotRequestData[]): RawCopilotRawMessage[] {
    const messages: RawCopilotRawMessage[] = []

    for (const request of requests) {
      // Add user message
      if (request.message?.text) {
        messages.push({
          attachments: this.extractAttachments(request.variableData),
          content: request.message.text,
          type: 'user',
        } as RawCopilotRawMessage)
      }

      // Add assistant response(s)
      if (request.response && Array.isArray(request.response)) {
        const responseContent = request.response.map((block: RawCopilotResponseBlock) => this.normalizeContentBlock(block))

        if (responseContent.length > 0) {
          // If single string, use it directly; if single block, use it; otherwise filter blocks only
          let content: RawCopilotContentBlock | RawCopilotContentBlock[] | string
          if (responseContent.length === 1 && typeof responseContent[0] === 'string') {
            content = responseContent[0] as string
          } else {
            const blockContent = responseContent.filter((item): item is RawCopilotContentBlock => typeof item !== 'string')
            content = blockContent.length === 1 ? blockContent[0] : blockContent
          }

          messages.push({
            content,
            type: 'assistant',
          } as RawCopilotRawMessage)
        }
      }
    }

    return messages
  }

  // ========================================================================
  // Private Methods - Parsing
  // ========================================================================

  /**
   * Detect VS Code Copilot workspace storage path
   *
   * Locates the VS Code workspace storage directory where GitHub Copilot chat sessions
   * are stored. Defaults to ~/Library/Application Support/Code/User/workspaceStorage
   * on macOS or constructs path from HOME environment variable.
   *
   * @returns Absolute path to VS Code workspace storage directory
   * @throws Error if VS Code workspace storage directory not found
   */
  private detectWorkspacePath(): string {
    const homedir = process.env.HOME || DEFAULT_HOME_DIR
    const defaultPath = join(homedir, VS_CODE_STORAGE_PATH)

    if (fs.existsSync(defaultPath)) {
      return defaultPath
    }

    throw new Error(`VS Code workspace storage not found at ${defaultPath}`)
  }

  /**
   * Extract attachment file names from variable data
   *
   * Extracts names of attached files/references from Copilot variable data.
   * Returns empty array if variable data is missing or contains no variables.
   *
   * @param variableData - Optional Copilot variable data containing attachments
   * @returns Array of attachment file names
   */
  private extractAttachments(variableData: RawCopilotVariableData | undefined): string[] {
    const attachments: string[] = []

    if (!variableData?.variables || !Array.isArray(variableData.variables)) {
      return attachments
    }

    for (const variable of variableData.variables) {
      if (variable.name) {
        attachments.push(variable.name)
      }
    }

    return attachments
  }

  // ========================================================================
  // Private Methods - Data Transformation
  // ========================================================================

  /**
   * Extract metadata from session data
   *
   * Aggregates session metadata including message counts, participant information,
   * total duration, and workspace identification. Calculates message count as requests * 2
   * (user + assistant message per request).
   *
   * @param data - Copilot session file data
   * @param sessionId - Unique session identifier
   * @param workspaceHash - Workspace hash identifying the workspace
   * @returns Extracted RawCopilotSessionMetadata object
   */
  private extractMetadata(
    data: RawCopilotSessionFileData,
    sessionId: string,
    workspaceHash: string
  ): RawCopilotSessionMetadata {
    const requests = data.requests || []

    return {
      initialLocation: data.initialLocation || UNKNOWN_LOCATION,
      messageCount: Math.max(0, requests.length * 2), // Each request has user + assistant
      requestCount: requests.length,
      requesterUsername: data.requesterUsername || UNKNOWN_USERNAME,
      responderUsername: data.responderUsername || GITHUB_COPILOT,
      sessionId,
      totalDuration: this.calculateTotalDuration(requests),
      workspace: {
        path: workspaceHash
      }
    }
  }

  /**
   * Extract session title from first message or request
   *
   * Uses the first message content as session title (preferred), falls back to first request text.
   * Truncates to TITLE_TRUNCATE_LENGTH (100) if content exceeds TITLE_MAX_LENGTH (150) characters.
   * Appends ellipsis ("...") if truncated. Returns default title if no messages or requests.
   *
   * @param requests - Array of Copilot requests (fallback source)
   * @param messages - Array of normalized messages (preferred source)
   * @returns Session title string (max 103 characters with ellipsis)
   */
  private extractTitle(requests: RawCopilotRequestData[], messages: RawCopilotRawMessage[]): string {
    // Try to use first message text
    if (messages.length > 0 && typeof messages[0].content === 'string') {
      const text = messages[0].content
      return text.length > TITLE_MAX_LENGTH ? text.slice(0, Math.max(0, TITLE_TRUNCATE_LENGTH)) + TITLE_ELLIPSIS : text
    }

    // Fallback to first request message
    if (requests.length > 0 && requests[0].message?.text) {
      const {text} = requests[0].message
      return text.length > TITLE_MAX_LENGTH ? text.slice(0, Math.max(0, TITLE_TRUNCATE_LENGTH)) + TITLE_ELLIPSIS : text
    }

    return DEFAULT_SESSION_TITLE
  }

  /**
   * Extract workspace path using hybrid approach
   *
   * Attempts extraction using two tiers in order of reliability:
   * - Tier 1A: SQLite scm:view:visibleRepositories (most reliable, handles monorepos)
   * - Tier 1B: baseUri.path from session data (fallback approach)
   * Returns single string for single repo, array for monorepo, or null if not found.
   *
   * @param data - Copilot session file data (used for Tier 1B fallback)
   * @param workspaceHash - Workspace hash for SQLite database lookup
   * @returns Workspace path(s) as string, string array, or null if not found
   */
  private extractWorkspacePath(data: RawCopilotSessionFileData, workspaceHash: string): null | string | string[] {
    // Tier 1A: Try SQLite first
    const tier1aResult = this.extractWorkspacePathTier1A(workspaceHash)
    if (tier1aResult) {
      return tier1aResult
    }

    // Tier 1B: Fall back to baseUri extraction
    const tier1bResult = this.extractWorkspacePathTier1B(data)
    if (tier1bResult) {
      return tier1bResult
    }

    return null
  }

  /**
   * Tier 1A: Extract repository paths from VS Code SQLite state.vscdb
   * This is the most reliable source as it contains actual repositories visible in the workspace
   * and can handle multi-repo/monorepo setups
   *
   * Returns:
   * - Array of strings for monorepo/multi-repo workspaces
   * - Single string for single-repo workspaces
   * - null if not found
   */
  private extractWorkspacePathTier1A(workspaceHash: string): null | string | string[] {
    try {
      const dbPath = join(this.workspaceStoragePath, workspaceHash, 'state.vscdb')

      if (!fs.existsSync(dbPath)) {
        return null
      }

      const db = new Database(dbPath, { readonly: true })

      try {
        // Query for scm:view:visibleRepositories
        const stmt = db.prepare(`SELECT value FROM ItemTable WHERE key = '${SCM_REPOSITORIES_KEY}'`)
        const row = stmt.get() as RawCopilotDatabaseRow | undefined

        if (!row?.value) {
          return null
        }

        // Parse the JSON value
        const scmData = JSON.parse(row.value) as { all?: string[] }
        const repositories = scmData.all

        if (!repositories || repositories.length === 0) {
          return null
        }

        // Extract all repository paths
        // Format is: git:Git:file:///path/to/repo
        const extractedPaths: string[] = []
        for (const repoUri of repositories) {
          const pathMatch = repoUri.match(FILE_URI_PATTERN)
          if (pathMatch && pathMatch[1]) {
            extractedPaths.push(pathMatch[1])
          }
        }

        if (extractedPaths.length === 0) {
          return null
        }

        // Return array for multiple repos, string for single repo
        return extractedPaths.length > 1 ? extractedPaths : extractedPaths[0]
      } finally {
        db.close()
      }
    } catch {
      return null
    }
  }

  /**
   * Extract workspace path from baseUri in session data (Tier 1B fallback)
   *
   * Recursively searches session data for objects with baseUri.path property containing
   * an absolute file path. Used as fallback when SQLite extraction fails. Returns first
   * valid path found, or null if no baseUri path found.
   *
   * @param data - Copilot session file data to search
   * @returns Extracted workspace path string, or null if not found
   */
  private extractWorkspacePathTier1B(data: RawCopilotSessionFileData): null | string {
    const traverse = (obj: unknown): null | string => {
      if (!obj || typeof obj !== 'object') return null

      const objRecord = obj as Record<string, unknown>

      // If this object has baseUri with path, return it
      const baseUri = objRecord.baseUri as Record<string, unknown> | undefined
      if (baseUri?.path && typeof baseUri.path === 'string') {
        const filePath = baseUri.path
        if (filePath.startsWith('/')) {
          return filePath
        }
      }

      // Traverse all properties
      for (const key in objRecord) {
        if (typeof objRecord[key] === 'object' && objRecord[key] !== null) {
          const result = traverse(objRecord[key])
          if (result) return result
        }
      }

      return null
    }

    return traverse(data)
  }

  /**
   * Normalize Copilot content blocks
   *
   * Converts various content block formats to normalized RawCopilotContentBlock format.
   * Preserves string content as-is, ensures all blocks have a kind field (defaults to 'unknown'),
   * and stringifies non-object content as fallback.
   *
   * @param block - Content block to normalize (string or object)
   * @returns Normalized content block or string
   */
  private normalizeContentBlock(block: RawCopilotResponseBlock | string): RawCopilotContentBlock | string {
    if (typeof block === 'string') {
      return block
    }

    if (!block || typeof block !== 'object') {
      return JSON.stringify(block)
    }

    // Return block as-is with kind field
    return {
      kind: block.kind || UNKNOWN_KIND,
      ...block
    } as RawCopilotContentBlock
  }

  /**
   * Normalize a Copilot request to RawCopilotParsedRequest type
   *
   * Standardizes request data structure, ensuring all required fields have values
   * (using empty defaults where needed). Preserves response, result, and variable data.
   *
   * @param req - Raw Copilot request data to normalize
   * @returns Normalized RawCopilotParsedRequest object
   */
  private normalizeParsedRequest(req: RawCopilotRequestData): RawCopilotParsedRequest {
    // Normalize response array if present
    let response: undefined | unknown[]
    if (Array.isArray(req.response)) {
      response = req.response
    }

    return {
      message: req.message || {},
      requestId: req.requestId || '',
      response: response as RawCopilotResponseItem[] | undefined,
      responseId: req.responseId || '',
      result: req.result,
      variableData: req.variableData,
    }
  }

  /**
   * Parse GitHub Copilot sessions from a custom directory
   *
   * Handles two directory structures:
   * 1. Direct workspace directory (containing chatSessions/ subdirectory)
   * 2. Parent directory (containing multiple workspace hash subdirectories)
   * Parses all workspace directories in parallel and returns combined sessions array.
   *
   * @param customDir - Path to custom directory containing Copilot session data
   * @returns Promise resolving to array of parsed RawCopilotRawSession objects
   */
  private async parseFromDirectory(customDir: string): Promise<RawCopilotRawSession[]> {
    const sessions: RawCopilotRawSession[] = []

    try {
      // Check if the provided directory itself contains chatSessions
      const chatSessionsPath = join(customDir, 'chatSessions')
      if (fs.existsSync(chatSessionsPath)) {
        // This is a workspace directory, parse it directly
        const workspaceSessions = await this.parseWorkspaceDirectory(
          customDir,
          basename(customDir)
        )
        sessions.push(...workspaceSessions)
        return sessions
      }

      // Otherwise, iterate through subdirectories looking for workspace directories
      const workspaceDirs = fs.readdirSync(customDir)

      const parsePromises = workspaceDirs
        .filter((workspaceDir) => {
          const workspacePath = join(customDir, workspaceDir)
          const stat = fs.statSync(workspacePath)
          return stat.isDirectory()
        })
        .map((workspaceDir) =>
          this.parseWorkspaceDirectory(join(customDir, workspaceDir), workspaceDir)
        )

      const allSessions = await Promise.all(parsePromises)
      for (const workspaceSessions of allSessions) {
        sessions.push(...workspaceSessions)
      }
    } catch (error) {
      console.error('Error parsing custom directory:', error)
    }

    return sessions
  }

  /**
   * Parse a single Copilot session file
   *
   * Reads and parses a GitHub Copilot session JSON file, extracting all session data
   * including messages, metadata, requests, title, and workspace information.
   * Returns null if file cannot be read or parsed.
   *
   * @param filePath - Absolute path to Copilot session JSON file
   * @param workspaceHash - Workspace hash for the session (used for lookups)
   * @returns Parsed RawCopilotRawSession object, or null if parsing fails
   */
  private parseSessionFile(filePath: string, workspaceHash: string): null | RawCopilotRawSession {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = JSON.parse(content) as RawCopilotSessionFileData

      const sessionId = basename(filePath, '.json')
      const requests = data.requests || []

      // Convert requests to messages
      const messages = this.convertRequestsToMessages(requests)

      // Generate title from first message or request
      const title = this.extractTitle(requests, messages)

      // Extract metadata
      const metadata = this.extractMetadata(data, sessionId, workspaceHash)

      // Extract workspace path using hybrid approach (Tier 1A SQLite, fallback to Tier 1B baseUri)
      const workspacePath = this.extractWorkspacePath(data, workspaceHash)

      return {
        id: sessionId,
        messages,
        metadata,
        requests: requests.map((req: RawCopilotRequestData) => this.normalizeParsedRequest(req)),
        timestamp: Date.now(),
        title,
        workspaceHash,
        workspacePath: workspacePath || undefined,
      } as RawCopilotRawSession
    } catch (error) {
      console.error(`Error parsing session ${filePath}:`, error)
      return null
    }
  }

  /**
   * Parse sessions from a specific workspace directory
   *
   * Reads all .json files from the chatSessions subdirectory within a workspace,
   * parses each session file, and returns array of successfully parsed sessions.
   * Returns empty array if chatSessions directory doesn't exist. Logs errors for
   * failed parses but continues processing remaining files.
   *
   * @param workspacePath - Path to workspace directory containing chatSessions
   * @param workspaceHash - Workspace hash for the workspace
   * @returns Promise resolving to array of parsed RawCopilotRawSession objects
   */
  private async parseWorkspaceDirectory(
    workspacePath: string,
    workspaceHash: string
  ): Promise<RawCopilotRawSession[]> {
    const sessions: RawCopilotRawSession[] = []
    const chatSessionsDir = join(workspacePath, 'chatSessions')

    if (!fs.existsSync(chatSessionsDir)) {
      return sessions
    }

    try {
      const files = fs.readdirSync(chatSessionsDir)

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(chatSessionsDir, file)
          const session = this.parseSessionFile(filePath, workspaceHash)
          if (session) {
            sessions.push(session)
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing workspace ${workspaceHash}:`, error)
    }

    return sessions
  }
}
