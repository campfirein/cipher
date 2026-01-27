/**
 * Raw Parser Service Factory
 * Routes IDE-based parsing requests to the appropriate parser service
 * Supports: Claude Code, Cursor, GitHub Copilot, Codex
 */

import { Agent } from '../../../core/domain/entities/agent.js'
import { IRawParserService } from '../../../core/interfaces/parser/i-raw-parser-service.js'
import { ClaudeRawService } from './raw-claude-service.js'
import { CodexRawService } from './raw-codex-service.js'
import { CopilotRawService } from './raw-copilot-service.js'
import { CursorRawService } from './raw-cursor-service.js'

/**
 * Raw Parser Service Factory
 * Creates and returns appropriate parser service for the given IDE
 */
export class RawParserServiceFactory {
  private static readonly SUPPORTED_IDES: Agent[] = ['Claude Code', 'Cursor', 'Github Copilot', 'Codex']

  /**
   * Create a raw parser service for the specified IDE
   *
   * Factory method that instantiates the appropriate raw parser service
   * based on the provided IDE type. Routes to specialized service classes.
   *
   * @param ide - The IDE type: 'Claude Code', 'Cursor', 'Github Copilot', or 'Codex'
   * @returns The appropriate raw parser service instance
   * @throws Error if IDE is not supported
   */
  static createRawParserService(ide: Agent): IRawParserService {
    switch (ide) {
      case 'Claude Code': {
        return new ClaudeRawService(ide)
      }

      case 'Codex': {
        return new CodexRawService(ide)
      }

      case 'Cursor': {
        return new CursorRawService(ide)
      }

      case 'Github Copilot': {
        return new CopilotRawService(ide)
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
   * Returns array of all IDE types that have corresponding raw parser services.
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
   * Parse conversations for the specified IDE
   *
   * Creates appropriate service and delegates to its parse method to extract
   * and transform raw conversation data from IDE storage.
   *
   * @param ide - The IDE type (Claude Code, Cursor, Github Copilot, Codex)
   * @param customDir - Path to custom directory containing IDE session data
   * @param outputDir - Optional output directory (defaults to process.cwd()/.brv/logs/{ide}/raw)
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  static async parseConversations(ide: Agent, customDir: string, outputDir?: string): Promise<boolean> {
    const service = this.createRawParserService(ide)
    return service.parse(customDir, outputDir)
  }
}
