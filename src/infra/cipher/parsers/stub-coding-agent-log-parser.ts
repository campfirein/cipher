import {extname} from 'node:path'

import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'

import {createParsedInteraction, type ParsedInteraction} from '../../../core/domain/cipher/parsed-interaction.js'

/**
 * Stub implementation of ICodingAgentLogParser.
 * This is a temporary parser that returns mock data until the real parser is implemented.
 * TODO: Replace with actual parser implementation when available.
 */
export class StubCodingAgentLogParser implements ICodingAgentLogParser {
  private static readonly VALID_EXTENSIONS = new Set(['.json', '.log'])

  /**
   * Validates if a file can be parsed based on its extension.
   * Currently accepts .log and .json files.
   */
  public isValidLogFile(filePath: string): boolean {
    const extension = extname(filePath).toLowerCase()
    return StubCodingAgentLogParser.VALID_EXTENSIONS.has(extension)
  }

  /**
   * Parses a log file and returns mock ParsedInteraction data.
   * This is a stub implementation for testing purposes.
   * @throws Error if the file path is empty or has an invalid extension
   */
  public async parseLogFile(filePath: string): Promise<ParsedInteraction[]> {
    if (filePath.trim() === '') {
      throw new Error('File path cannot be empty')
    }

    if (!this.isValidLogFile(filePath)) {
      throw new Error(`${filePath} is not a valid log file. Accepted extensions: .log, .json`)
    }

    console.warn('[StubCodingAgentLogParser] Using stub parser - replace with real implementation')
    const interaction = createParsedInteraction({
      agentResponse: 'This is a stub response from the parser',
      agentType: 'stub',
      metadata: {
        originalFile: filePath,
        source: 'stub-parser',
      },
      timestamp: Date.now(),
      userMessage: 'This is a stub user message',
    })
    return [interaction]
  }
}
