import type {ParsedInteraction} from '../../domain/cipher/parsed-interaction.js'

/** Options for starting the coding agent log watcher. */
type CodingAgentLogWatcherOptions = {
  /** Callback invoked when interactions are parsed from log files */
  onInteraction: (interaction: ParsedInteraction) => Promise<void>

  /** Paths to watch for coding agent log files */
  paths: string[]
}

/**
 * Interface for watching coding agent log files and processing interactions.
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
