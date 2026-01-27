import type {CleanSession} from '../../../server/core/domain/entities/parser.js'

import {Agent} from '../../../server/core/domain/entities/agent.js'

/**
 * Interface for parsing coding agent log files.
 * Implementations use the raw/clean parser pipeline to process log files
 * from various coding agents (Claude Code, GitHub Copilot, Cursor, Codex, etc.).
 */
export interface ICodingAgentLogParser {
  /**
   * Parses coding agent log files using the configured IDE and chat log path.
   *
   * This method follows the two-phase raw/clean parser pipeline:
   * 1. Raw Phase: Parse IDE-specific files, write to .brv/logs/{ide}/raw/
   * 2. Clean Phase: Read from .brv/logs/{ide}/raw/, normalize to CleanSession format
   *
   * @returns A promise that resolves to a frozen array of CleanSession objects
   * @throws Error if parsing fails at any phase
   */
  parse: (chatLogPath: string, ide: Agent) => Promise<readonly CleanSession[]>
}
