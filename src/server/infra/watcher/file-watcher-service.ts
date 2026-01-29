import {type FSWatcher, watch} from 'chokidar'

import type {FileEvent, IFileWatcherService} from '../../core/interfaces/services/i-file-watcher-service.js'

export class FileWatcherService implements IFileWatcherService {
  private eventHandler: ((event: FileEvent) => Promise<void>) | undefined
  private watcher: FSWatcher | undefined

  public constructor() {
    this.eventHandler = undefined
    this.watcher = undefined
  }

  public setFileEventHandler(handler: (event: FileEvent) => Promise<void>): void {
    this.eventHandler = handler
  }

  public async start(paths: string[]): Promise<void> {
    this.watcher = watch(paths, {
      // `false` means the `add` events will be emitted for files already existing when the watcher starts.
      // May need to change to `true` in the future because:
      //   - We only care about NEW LOGS that agents write AFTER we start watching.
      //   - We don't want to process old/existing log files that were already there.
      //   - Cleaner output - no flood of events when watcher starts.
      ignoreInitial: true,
      // Keep watching indefinitely (we want a long-running watcher)
      persistent: true,
    })

    // Register event LISTENERS for all file system events
    // Note: invokeHandler is async and handles errors internally
    this.watcher.on('add', async (path) => {
      await this.invokeHandler('add', path)
    })

    this.watcher.on('addDir', async (path) => {
      await this.invokeHandler('addDir', path)
    })

    this.watcher.on('change', async (path) => {
      await this.invokeHandler('change', path)
    })

    this.watcher.on('unlink', async (path) => {
      await this.invokeHandler('unlink', path)
    })

    this.watcher.on('unlinkDir', async (path) => {
      await this.invokeHandler('unlinkDir', path)
    })

    // Wait for watcher to be ready.
    // The 'ready' event fires when
    // chokidar has completed its initial scan of the directories (regardless of ignoreInitial setting)
    // With ignoreInitial: false, the timeline is:
    // 1. chokidar.watch() called
    // 2. Scans directories
    // 3. Emits 'add' events for 100 existing files
    // 4. 'ready' event fires ← "Done with initial scan"
    // 5. Now watching for new changes
    //
    // With ignoreInitial: true, timeline is:
    // 1. chokidar.watch() called
    // 2. Scans directories (still happens!)
    // 3. Doesn't emit 'add' events for existing files
    // 4. 'ready' event fires ← "Done with initial scan"
    // 5. Now watching for new changes
    // 'ready' is still useful for ignoreInitial: true.
    await new Promise<void>((resolve) => {
      this.watcher?.on('ready', () => {
        resolve()
      })
    })
  }

  public async stop(): Promise<void> {
    if (this.watcher !== undefined) {
      await this.watcher.close()
      this.watcher = undefined
    }

    this.eventHandler = undefined
  }

  private async invokeHandler(type: FileEvent['type'], path: string): Promise<void> {
    if (this.eventHandler !== undefined) {
      const event: FileEvent = {path, type}
      try {
        await this.eventHandler(event)
      } catch (error) {
        console.error(`[FileWatcherService] Error in event handler for ${type} ${path}:`, error)
      }
    }
  }
}
