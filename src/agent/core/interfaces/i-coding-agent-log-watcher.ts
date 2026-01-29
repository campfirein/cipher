import type {CleanSession} from '../../../server/core/domain/entities/parser.js'

import {Agent} from '../../../server/core/domain/entities/agent.js'

/** Options for starting the coding agent log watcher. */
export type CodingAgentLogWatcherOptions = {
  codingAgentInfo: {
    chatLogPath: string
    name: Agent
  }

  /** Callback invoked when sessions are parsed from log files */
  onCleanSession: (cleanSession: CleanSession) => Promise<void>
}

/**
 * Interface for watching coding agent log files and processing sessions.
 * Implementations should handle the first watch (process existing files) differently from subsequent watches (only new/changed files).
 */
export interface ICodingAgentLogWatcher {
  /**
   * Checks if the watcher is currently active.
   * @returns true if watching, false otherwise.
   */
  isWatching: () => boolean

  /**
   * Starts watching the specified paths for coding agent log files.
   * On initial start, processes existing files. Subsequent watches only process new or changed files.
   * @param options Configuration options including paths and callback
   * @throws Error if already watching or if paths are invalid
   */
  start: (options: CodingAgentLogWatcherOptions) => Promise<void>

  /** Stops watching for file changes and cleans up resources */
  stop: () => Promise<void>
}
