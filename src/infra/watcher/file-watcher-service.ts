import {type FSWatcher, watch} from 'chokidar'

import type {FileEvent, IFileWatcherService} from '../../core/interfaces/i-file-watcher-service.js'

export class FileWatcherService implements IFileWatcherService {
  private eventHandlers: ((event: FileEvent) => void)[]
  private watcher: FSWatcher | undefined

  public constructor() {
    this.eventHandlers = []
    this.watcher = undefined
  }

  public onFileEvent(handler: (event: FileEvent) => void): void {
    this.eventHandlers.push(handler)
  }

  public async start(paths: string[]): Promise<void> {
    this.watcher = watch(paths, {
      // `false` means the `add` events will be emitted for files already existing when the watcher starts.
      // May need to change to `true` in the future because:
      //   - We only care about NEW LOGS that agents write AFTER we start watching.
      //   - We don't want to process old/existing log files that were already there.
      //   - Cleaner output - no flood of events when watcher starts.
      ignoreInitial: false,
      // Keep watching indefinitely (we want a long-running watcher)
      persistent: true,
    })

    // Register event LISTENERS for all file system events
    this.watcher.on('add', (path) => {
      this.invokeHandlers('add', path)
    })

    this.watcher.on('addDir', (path) => {
      this.invokeHandlers('addDir', path)
    })

    this.watcher.on('change', (path) => {
      this.invokeHandlers('change', path)
    })

    this.watcher.on('unlink', (path) => {
      this.invokeHandlers('unlink', path)
    })

    this.watcher.on('unlinkDir', (path) => {
      this.invokeHandlers('unlinkDir', path)
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
  }

  private invokeHandlers(type: FileEvent['type'], path: string): void {
    const event: FileEvent = {path, type}
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }
}
