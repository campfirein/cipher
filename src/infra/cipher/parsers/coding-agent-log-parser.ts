/**
 * Coding Agent Log Parser
 * Parses coding agent log files using the existing raw/clean parser pipeline
 * Follows the same logic as the 'brv watch' command's triggerParsing method
 */

import type {CleanSession} from '../../../core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'

import {Agent} from '../../../core/domain/entities/agent.js'
import {CleanParserServiceFactory} from '../../parsers/clean/clean-parser-service-factory.js'
import {RawParserServiceFactory} from '../../parsers/raw/raw-parser-service-factory.js'

/**
 * Coding Agent Log Parser
 *
 * Reuses the existing raw/clean parser infrastructure to parse coding agent log files.
 * This implementation follows the same two-phase pipeline as the 'brv watch' command:
 *
 * 1. Raw Phase: Parse IDE-specific files from chatLogPath directory, write to .brv/logs/{ide}/raw/
 * 2. Clean Phase: Read from .brv/logs/{ide}/raw/, normalize to CleanSession format
 *
 * Note: This parser processes entire directories (not individual files) for consistency
 * with the existing parser architecture. When a single file changes, all files in the
 * directory will be re-parsed. This is inefficient but safe, and can be optimized later.
 */
export class CodingAgentLogParser implements ICodingAgentLogParser {
  private readonly chatLogPath: string
  private readonly ide: Agent

  public constructor(chatLogPath: string, ide: Agent) {
    if (!RawParserServiceFactory.isSupported(ide)) {
      throw new Error(`Unsupported IDE: ${ide}`)
    }

    if (!chatLogPath || chatLogPath.trim().length === 0) {
      throw new Error('Chat log path cannot be empty')
    }

    this.chatLogPath = chatLogPath
    this.ide = ide
  }

  public async parseLogFile(): Promise<readonly CleanSession[]> {
    let isRawSuccess = false
    try {
      isRawSuccess = await RawParserServiceFactory.parseConversations(this.ide, this.chatLogPath)
    } catch (error) {
      throw new Error(`Raw parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    if (isRawSuccess) {
      try {
        const rawOutputDir = `${process.cwd()}/.brv/logs/${this.ide}/raw`
        const cleanSessions = await CleanParserServiceFactory.parseConversations(this.ide, rawOutputDir)

        if (cleanSessions.length > 0) {
          return Object.freeze(cleanSessions)
        }

        throw new Error('Clean parsing returned no sessions')
      } catch (error) {
        throw new Error(`Clean parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    throw new Error('Raw parsing failed')
  }
}
