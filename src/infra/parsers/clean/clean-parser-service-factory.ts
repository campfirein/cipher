/**
 * Clean Parser Service Factory
 * Routes IDE-based clean parsing requests to the appropriate clean parser service
 * Supports: Claude Code, Cursor, GitHub Copilot, Codex
 */

import { Agent } from '../../../core/domain/entities/agent.js'
import { ICleanParserService } from '../../../core/interfaces/parser/i-clean-parser-service.js'
import { ClaudeCleanService } from './clean-claude-service.js'
import { CodexCleanService } from './clean-codex-service.js'
import { CopilotCleanService } from './clean-copilot-service.js'
import { CursorCleanService } from './clean-cursor-service.js'

/**
 * Clean Parser Service Factory
 * Creates and returns appropriate clean parser service for the given IDE
 */
export class CleanParserServiceFactory {
  private static readonly SUPPORTED_IDES: Agent[] = ['Claude Code', 'Cursor', 'Github Copilot', 'Codex']

  /**
   * Create a clean parser service for the specified IDE
   *
   * Factory method that instantiates the appropriate clean parser service
   * based on the provided IDE type. Routes to specialized service classes.
   *
   * @param ide - The IDE type: 'Claude Code', 'Cursor', 'Github Copilot', or 'Codex'
   * @returns The appropriate clean parser service instance
   * @throws Error if IDE is not supported
   */
  static createCleanParserService(ide: Agent): ICleanParserService {
    switch (ide) {
      case 'Claude Code': {
        return new ClaudeCleanService(ide)
      }

      case 'Codex': {
        return new CodexCleanService(ide)
      }

      case 'Cursor': {
        return new CursorCleanService(ide)
      }

      case 'Github Copilot': {
        return new CopilotCleanService(ide)
      }

      default: {
        throw new Error(
          `Unsupported IDE: ${ide}. Supported IDEs are: claude, cursor, copilot, codex`
        )
      }
    }
  }

  /**
   * Get list of supported IDEs
   *
   * Returns array of all IDE types that have corresponding clean parser services.
   *
   * @returns Array of supported IDE type strings
   */
  static getSupportedIDEs(): Agent[] {
    return [...this.SUPPORTED_IDES]
  }

  /**
   * Check if IDE is supported
   *
   * Validates whether the provided IDE string corresponds to a supported IDE.
   *
   * @param ide - IDE name to validate
   * @returns True if IDE is in supported list, false otherwise
   */
  static isSupported(ide: Agent): boolean {
    return this.getSupportedIDEs().includes(ide)
  }

  /**
   * Parse and clean conversations for the specified IDE
   *
   * Creates appropriate service and delegates to its parse method to transform
   * raw session data into clean normalized format.
   *
   * @param ide - The IDE type (Claude Code, Cursor, Github Copilot, Codex)
   * @param rawDir - Path to directory containing raw session files
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  static async parseConversations(ide: Agent, rawDir: string): Promise<boolean> {
    const service = this.createCleanParserService(ide)
    return service.parse(rawDir)
  }
}
