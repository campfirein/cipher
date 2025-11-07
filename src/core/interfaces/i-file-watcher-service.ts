/**
 * Represents a file system event.
 */
export type FileEvent = {
  /**
   * The path to the file or directory that changed.
   */
  path: string

  /**
   * The type of event that occurred.
   * - add: File added
   * - addDir: Directory added
   * - change: File modified
   * - unlink: File deleted
   * - unlinkDir: Directory deleted
   */
  type: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
}

export interface IFileWatcherService {
  /**
   * Registers a handler to be called when file system events occur.
   * @param handler The callback function to invoke with file events.
   */
  onFileEvent: (handler: (event: FileEvent) => void) => void

  /**
   * Starts watching the specified paths for file system changes.
   * @param paths Array of directory paths to watch.
   * @returns Promise that resolves when watching has started.
   */
  start: (paths: string[]) => Promise<void>

  /**
   * Stops watching and cleans up resources.
   * @returns Promise that resolves when cleanup is complete.
   */
  stop: () => Promise<void>
}
