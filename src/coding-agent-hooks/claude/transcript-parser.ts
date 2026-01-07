/**
 * Transcript Parser
 *
 * Parse Claude Code JSONL transcript files and extract assistant text responses.
 * Filters out thinking, tool_use, tool_result blocks - only keeps text.
 */

import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'

import type {ContentBlock, TranscriptEntry} from './schemas.js'

import {debugLog} from '../shared/debug-logger.js'
import {TranscriptEntrySchema} from './schemas.js'

/**
 * Expand tilde (~) to home directory.
 * Follows the pattern from src/utils/file-validator.ts
 *
 * @param filePath - Path that may start with ~
 * @returns Path with ~ expanded to home directory
 */
export const expandTilde = (filePath: string): string =>
  filePath.startsWith('~') ? filePath.replace(/^~/, homedir()) : filePath

/**
 * Validate that transcript path is within expected Claude directory.
 * This prevents potential path traversal attacks.
 *
 * Platform-specific paths:
 * - Unix/macOS: ~/.claude/
 * - Windows: %APPDATA%\Claude\ (typically C:\Users\Name\AppData\Roaming\Claude)
 *
 * @param filePath - Path to validate (may contain ~)
 * @returns True if path is valid (within Claude directory and ends with .jsonl)
 */
export const isValidTranscriptPath = (filePath: string): boolean => {
  try {
    const expanded = expandTilde(filePath)
    const normalized = path.resolve(expanded)

    /**
     * Use platform-specific Claude directory.
     * NOTE: Windows path is untested - Claude Code may use different location.
     */
    const isWindows = process.platform === 'win32'
    const claudeBase = isWindows
      ? path.join(homedir(), 'AppData', 'Roaming', 'Claude')
      : path.join(homedir(), '.claude')

    return normalized.startsWith(claudeBase) && normalized.endsWith('.jsonl')
  } catch {
    return false
  }
}

/**
 * Extract text content from a single content block.
 * Only extracts 'text' type blocks, ignoring thinking/tool_use/tool_result.
 *
 * @param block - Content block to extract from
 * @returns Text content or undefined if not a text block
 */
export const extractTextFromBlock = (block: ContentBlock | string): string | undefined => {
  if (typeof block === 'string') {
    return block
  }

  if (block.type === 'text') {
    return block.text
  }

  return undefined
}

/**
 * Extract all text content from an assistant message.
 *
 * @param entry - Transcript entry to extract from
 * @returns Concatenated text content or undefined if not an assistant message
 */
export const extractTextFromMessage = (entry: TranscriptEntry): string | undefined => {
  if (entry.type !== 'assistant' || !entry.message) {
    return undefined
  }

  const {content} = entry.message

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textParts: string[] = []

    for (const block of content) {
      const text = extractTextFromBlock(block)
      if (text) {
        textParts.push(text)
      }
    }

    return textParts.length > 0 ? textParts.join('\n') : undefined
  }

  return undefined
}

/**
 * Parse individual JSONL lines and filter by timestamp.
 *
 * @param lines - Array of JSONL lines
 * @param afterTimestamp - Only include entries after this timestamp (ms since epoch)
 * @returns Array of valid transcript entries
 */
const parseLines = (lines: string[], afterTimestamp: number): TranscriptEntry[] => {
  const entries: TranscriptEntry[] = []

  for (const line of lines) {
    const entry = parseLine(line, afterTimestamp)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}

/**
 * Parse a single JSONL line and check timestamp.
 *
 * @param line - Single JSONL line
 * @param afterTimestamp - Only include if entry is after this timestamp
 * @returns Parsed entry or undefined if invalid/filtered
 */
const parseLine = (line: string, afterTimestamp: number): TranscriptEntry | undefined => {
  try {
    const result = TranscriptEntrySchema.safeParse(JSON.parse(line))
    if (!result.success) {
      debugLog('TRANSCRIPT', 'Invalid entry structure', {linePreview: line.slice(0, 100)})
      return undefined
    }

    const entry = result.data
    if (!entry.timestamp) return undefined

    const entryTime = new Date(entry.timestamp).getTime()
    if (entryTime < afterTimestamp) return undefined

    return entry
  } catch (error) {
    debugLog('TRANSCRIPT', 'Skipped malformed line', {
      error: error instanceof Error ? error.message : String(error),
      linePreview: line.slice(0, 100),
    })
    return undefined
  }
}

/**
 * Parse JSONL transcript file and return entries after a given timestamp.
 * Only entries with valid timestamps are included (strict mode).
 *
 * @param jsonlPath - Path to the JSONL transcript file
 * @param afterTimestamp - Only include entries after this timestamp (ms since epoch)
 * @returns Array of transcript entries
 */
export const parseTranscriptAfterTimestamp = async (
  jsonlPath: string,
  afterTimestamp: number,
): Promise<TranscriptEntry[]> => {
  if (!isValidTranscriptPath(jsonlPath)) {
    debugLog('TRANSCRIPT', 'Invalid transcript path rejected', {path: jsonlPath})
    return []
  }

  const expandedPath = expandTilde(jsonlPath)

  if (!existsSync(expandedPath)) {
    debugLog('TRANSCRIPT', 'Transcript file not found', {path: jsonlPath})
    return []
  }

  try {
    const content = await readFile(expandedPath, 'utf8')
    const lines = content.split('\n').filter((line) => line.trim())
    const entries = parseLines(lines, afterTimestamp)

    debugLog('TRANSCRIPT', 'Parsed transcript', {
      entriesFound: entries.length,
      totalLines: lines.length,
    })

    return entries
  } catch (error) {
    debugLog('TRANSCRIPT', 'Failed to parse transcript', {
      error: error instanceof Error ? error.message : String(error),
      path: jsonlPath,
    })
    return []
  }
}

/**
 * Extract the LAST assistant text response from transcript entries.
 * Iterates in reverse to find the most recent assistant text.
 *
 * @param entries - Array of transcript entries
 * @returns Last assistant text or undefined if none found
 */
export const extractLastAssistantText = (entries: TranscriptEntry[]): string | undefined => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = extractTextFromMessage(entries[i])
    if (text) {
      return text
    }
  }

  return undefined
}

/**
 * Combined function: parse transcript and get last assistant text.
 *
 * @param jsonlPath - Path to the JSONL transcript file
 * @param afterTimestamp - Only include entries after this timestamp (ms since epoch)
 * @returns Last assistant text or undefined if none found
 */
export const getLastAssistantResponse = async (
  jsonlPath: string,
  afterTimestamp: number,
): Promise<string | undefined> => {
  const entries = await parseTranscriptAfterTimestamp(jsonlPath, afterTimestamp)
  return extractLastAssistantText(entries)
}
