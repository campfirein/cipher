import type {CleanSession} from '../../../core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'

/**
 * Stub implementation of ICodingAgentLogParser.
 * This is a temporary parser that returns mock data for testing.
 * TODO: Remove once CodingAgentLogParser is integrated in agent-service-factory.
 */
export class StubCodingAgentLogParser implements ICodingAgentLogParser {
  /**
   * Parses log files and returns mock CleanSession data.
   * This is a stub implementation for testing purposes.
   */
  public async parseLogFile(): Promise<readonly CleanSession[]> {
    console.warn('[StubCodingAgentLogParser] Using stub parser - replace with real implementation')
    const stubSession: CleanSession = {
      id: `stub-session-${Date.now()}`,
      messages: [
        {
          content: [
            {
              text: 'This is a stub user message',
              type: 'text',
            },
          ],
          timestamp: new Date().toISOString(),
          type: 'user',
        },
        {
          content: [
            {
              text: 'This is a stub response from the parser',
              type: 'text',
            },
          ],
          timestamp: new Date().toISOString(),
          type: 'assistant',
        },
      ],
      metadata: {
        source: 'stub-parser',
      },
      timestamp: Date.now(),
      title: 'Stub Session',
      type: 'Claude',
      workspacePaths: [],
    }
    return Object.freeze([stubSession])
  }
}
