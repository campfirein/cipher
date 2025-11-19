/**
 * Claude Clean Service
 * Transforms Claude raw parsed data to clean normalized format
 * Consolidates agent sessions and normalizes messages
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import { CleanClaudeSessionLoadResult, RawClaudeRawSession } from '../../../core/domain/entities/parser.js'
import { ICleanParserService } from '../../../core/interfaces/parser/i-clean-parser-service.js'
import { normalizeClaudeSession } from './shared.js'


/**
 * Claude Clean Service
 * Transforms Claude raw parsed sessions to clean normalized format
 */
export class ClaudeCleanService implements ICleanParserService {
  private ide: Agent

  /**
   * Initialize Claude Clean Service
   *
   * @param ide - The IDE type (Claude Code)
   */
  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Parse and transform raw Claude sessions to clean normalized format
   *
   * Reads raw sessions organized by workspace, consolidates agent sessions into main
   * conversations, normalizes message format, and writes cleaned JSON files to output.
   *
   * @param rawDir - Path to directory containing raw Claude session files organized by workspace
   * @returns Promise resolving to true if transformation completed successfully, false on error
   */
  /* eslint-disable no-await-in-loop */
  async parse(rawDir: string): Promise<boolean> {
    const outputDir = path.join(process.cwd(), `.brv/logs/${this.ide}/clean`)

    console.log('🔍 Starting Claude clean transformation...')
    console.log(`📁 Raw directory: ${rawDir}`)

    try {
      // Create output directory
      await mkdir(outputDir, { recursive: true })

      // Read raw sessions organized by workspace
      const entries = await readdir(rawDir)

      let totalSessions = 0

      for (const entry of entries) {
        const workspacePath = path.join(rawDir, entry)
        const files = await readdir(workspacePath)
        const jsonFiles = files.filter((f) => f.endsWith('.json') && f !== 'summary.json')

        if (jsonFiles.length === 0) continue

        // Create workspace output directory
        const wsOutputDir = path.join(outputDir, entry)
        await mkdir(wsOutputDir, { recursive: true })

        // Load all sessions for consolidation
        const { agentSessions, allSessions } = await this.loadSessions(workspacePath, jsonFiles)

        // Process main sessions
        totalSessions += await this.processMainSessions(allSessions, agentSessions, wsOutputDir)
      }

      console.log(`\n🎉 Claude clean transformation complete! ${totalSessions} sessions saved to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during transformation:', error)
      return false
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Calculate string similarity score using word overlap method
   *
   * Computes similarity by comparing words with length > 3 characters.
   * Returns fraction of matching words relative to max length.
   *
   * @param str1 - First string to compare
   * @param str2 - Second string to compare
   * @returns Similarity score between 0 (no match) and 1 (perfect match)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = str1.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    const words2 = str2.toLowerCase().split(/\s+/).filter((w) => w.length > 3)

    if (words1.length === 0 || words2.length === 0) return 0

    const matches = words1.filter((w) => words2.some((w2) => w2.includes(w) || w.includes(w2)))
    return matches.length / Math.max(words1.length, words2.length)
  }

  /**
   * Consolidate agent session data into main conversation
   *
   * When main conversation contains Task subagent invocation, flattens the agent
   * session messages into the main message stream. Two-pass algorithm: first identify
   * Task invocations with matching agent sessions, then insert agent messages.
   *
   * @param mainSession - Main Claude conversation session to consolidate into
   * @param agentSessions - Map of agent sessions keyed by agent session ID
   * @returns Promise resolving to consolidated session with agent messages merged
   */
  private async consolidateAgentSessions(
    mainSession: RawClaudeRawSession,
    agentSessions: Map<string, RawClaudeRawSession>
  ): Promise<RawClaudeRawSession> {
    if (!mainSession.messages || mainSession.messages.length === 0) {
      return mainSession
    }

    // First pass: identify Task tool_use invocations that have matching agent sessions
    const taskToolUseIds = this.identifyTaskToolIds(mainSession.messages, agentSessions)

    // Second pass: flatten messages, inserting agent messages after Task invocations
    const newMessages = this.flattenMessagesWithAgentSessions(
      mainSession.messages,
      taskToolUseIds,
      agentSessions
    )

    return {
      ...mainSession,
      messages: newMessages,
    }
  }

  /**
   * Find best matching agent session for a task description and timestamp
   *
   * Locates matching agent session using similarity scoring and timestamp proximity.
   * Considers both task description similarity and temporal closeness (within 5 seconds).
   *
   * @param description - Task description from Task tool_use invocation
   * @param messageTimestamp - Timestamp of message containing Task invocation
   * @param agentSessions - Map of available agent sessions
   * @returns Matching agent session or null if no good match found
   */
  private findMatchingAgentSession(
    description: string,
    messageTimestamp: number,
    agentSessions: Map<string, RawClaudeRawSession>
  ): null | RawClaudeRawSession {
    let matchedAgent: null | RawClaudeRawSession = null
    let bestScore = 0.2 // Minimum similarity threshold

    for (const agentSession of agentSessions.values()) {
      const agentTitle = agentSession.title || ''
      const agentTimestamp = new Date(agentSession.timestamp).getTime()

      // Calculate similarity score
      let score = this.calculateSimilarity(description, agentTitle)

      // Boost score for nearby timestamps (within 5 seconds)
      const timeDiff = Math.abs(messageTimestamp - agentTimestamp)
      if (timeDiff < 5000) {
        score += 0.3
      }

      // If this is the best match so far, use it
      if (score > bestScore) {
        bestScore = score
        matchedAgent = agentSession
      }
    }

    return matchedAgent
  }

  /**
   * Flatten messages with agent sessions inserted after Task invocations
   *
   * Inserts agent session messages into message stream after Task tool_use invocations
   * that have matching agent sessions. Preserves message order.
   *
   * @param messages - Array of raw session messages
   * @param taskToolUseIds - Set of Task tool_use IDs that have matching agent sessions
   * @param agentSessions - Map of available agent sessions
   * @returns Flattened message array with agent messages interleaved
   */
  private flattenMessagesWithAgentSessions(
    messages: RawClaudeRawSession['messages'],
    taskToolUseIds: Set<string>,
    agentSessions: Map<string, RawClaudeRawSession>
  ): RawClaudeRawSession['messages'] {
    const newMessages: RawClaudeRawSession['messages'] = []

    for (const message of messages) {
      newMessages.push(message)

      if (message.type !== 'assistant' || !message.content || !Array.isArray(message.content)) {
        continue
      }

      for (const content of message.content as Array<Record<string, unknown>>) {
        if (content.type !== 'tool_use' || content.name !== 'Task') {
          continue
        }

        const contentId = content.id as string
        if (!taskToolUseIds.has(contentId)) {
          continue
        }

        const taskInput = (content.input as Record<string, unknown>) || {}
        const description = (taskInput.description as string) || ''
        const messageTimestamp = new Date(message.timestamp).getTime()

        const matchedAgent = this.findMatchingAgentSession(description, messageTimestamp, agentSessions)
        if (matchedAgent && matchedAgent.messages && Array.isArray(matchedAgent.messages)) {
          newMessages.push(...matchedAgent.messages)
        }
      }
    }

    return newMessages
  }

  /**
   * Identify Task tool_use IDs that have matching agent sessions
   *
   * Scans messages for Task tool_use invocations and identifies which ones
   * have corresponding agent sessions that can be consolidated.
   *
   * @param messages - Array of session messages
   * @param agentSessions - Map of available agent sessions
   * @returns Set of tool_use IDs that have matching agent sessions
   */
  private identifyTaskToolIds(
    messages: RawClaudeRawSession['messages'],
    agentSessions: Map<string, RawClaudeRawSession>
  ): Set<string> {
    const taskToolUseIds: Set<string> = new Set()

    for (const message of messages) {
      if (message.type !== 'assistant' || !message.content || !Array.isArray(message.content)) {
        continue
      }

      for (const content of message.content as Array<Record<string, unknown>>) {
        if (content.type !== 'tool_use' || content.name !== 'Task') {
          continue
        }

        const taskInput = (content.input as Record<string, unknown>) || {}
        const description = (taskInput.description as string) || ''
        const messageTimestamp = new Date(message.timestamp).getTime()

        const matchedAgent = this.findMatchingAgentSession(description, messageTimestamp, agentSessions)
        if (matchedAgent && matchedAgent.messages) {
          const contentId = content.id as string
          taskToolUseIds.add(contentId)
        }
      }
    }

    return taskToolUseIds
  }

  /**
   * Load and organize sessions from workspace directory
   *
   * Reads JSON files from workspace directory and organizes them into main sessions
   * and agent sessions based on filename prefix ('agent-' for agent sessions).
   *
   * @param workspacePath - Path to workspace directory containing session files
   * @param jsonFiles - Array of JSON filenames to load
   * @returns Promise resolving to object with separated agentSessions and allSessions maps
   */
  private async loadSessions(
    workspacePath: string,
    jsonFiles: string[]
  ): Promise<CleanClaudeSessionLoadResult> {
    const allSessions = new Map<string, RawClaudeRawSession>()
    const agentSessions = new Map<string, RawClaudeRawSession>()

    /* eslint-disable no-await-in-loop */
    for (const file of jsonFiles) {
      try {
        const content = await readFile(path.join(workspacePath, file), 'utf8')
        const session = JSON.parse(content)
        const sessionId = file.replace('.json', '')

        if (file.startsWith('agent-')) {
          agentSessions.set(sessionId, session)
        } else {
          allSessions.set(sessionId, session)
        }
      } catch (error) {
        console.warn(`⚠️  Failed to read ${file}:`, error instanceof Error ? error.message : String(error))
      }
    }
    /* eslint-enable no-await-in-loop */

    return { agentSessions, allSessions }
  }

  /**
   * Process main sessions and write normalized outputs
   *
   * Consolidates agent sessions, normalizes each session, and writes clean
   * JSON files to output directory.
   *
   * @param allSessions - Map of main sessions to process
   * @param agentSessions - Map of available agent sessions for consolidation
   * @param wsOutputDir - Output directory path for processed sessions
   * @returns Promise resolving to count of successfully processed sessions
   */
  private async processMainSessions(
    allSessions: Map<string, RawClaudeRawSession>,
    agentSessions: Map<string, RawClaudeRawSession>,
    wsOutputDir: string
  ): Promise<number> {
    let totalSessions = 0

    /* eslint-disable no-await-in-loop */
    for (const [sessionId, session] of allSessions) {
      try {
        // Consolidate agent sessions if any exist
        let consolidatedSession = session
        if (agentSessions.size > 0) {
          consolidatedSession = await this.consolidateAgentSessions(session, agentSessions)
        }

        // Normalize the session
        const normalized = normalizeClaudeSession(consolidatedSession as unknown as Record<string, unknown>, 'Claude')

        // Write normalized session
        const outputFile = path.join(wsOutputDir, `${sessionId}.json`)
        await writeFile(outputFile, JSON.stringify(normalized, null, 2))
        totalSessions++
        console.log(`    ✅ ${session.title}`)
      } catch (error) {
        console.warn(`⚠️  Failed to transform ${sessionId}:`, error instanceof Error ? error.message : String(error))
      }
    }
    /* eslint-enable no-await-in-loop */

    return totalSessions
  }
}