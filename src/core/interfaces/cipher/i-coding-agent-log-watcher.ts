import type {CleanSession} from '../../domain/entities/parser.js'

/** Options for starting the coding agent log watcher. */
export type CodingAgentLogWatcherOptions = {
  /** Callback invoked when sessions are parsed from log files */
  onSession: (session: CleanSession) => Promise<void>

  /** Paths to watch for coding agent log files */
  paths: string[]
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
