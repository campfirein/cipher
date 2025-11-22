import type {CleanSession} from '../../../core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {CodingAgentLogWatcherOptions, ICodingAgentLogWatcher} from '../../../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import type {FileEvent, IFileWatcherService} from '../../../core/interfaces/i-file-watcher-service.js'

type OnSessionCallback = (session: CleanSession) => Promise<void>

export class CodingAgentLogWatcher implements ICodingAgentLogWatcher {
  private callback: OnSessionCallback | undefined
  private readonly fileWatcher: IFileWatcherService
  private firstWatch: boolean
  private readonly parser: ICodingAgentLogParser
  private processedAddFiles: Set<string>
  private watching: boolean

  public constructor(fileWatcher: IFileWatcherService, parser: ICodingAgentLogParser) {
    this.firstWatch = true
    this.processedAddFiles = new Set<string>()
    this.watching = false
    this.fileWatcher = fileWatcher
    this.parser = parser
  }

  public isWatching(): boolean {
    return this.watching
  }

  public async start(options: CodingAgentLogWatcherOptions): Promise<void> {
    if (this.watching) {
      throw new Error('Already watching. Stop the watcher before starting again.')
    }

    this.callback = options.onSession
    this.watching = true

    this.fileWatcher.setFileEventHandler(async (event: FileEvent) => {
      await this.handleFileEvent(event)
    })

    await this.fileWatcher.start(options.paths)

    // After first watch completes, mark as no longer first
    // TODO; Need to find a better way to determine when the initial scan is done.
    // Could you brv config.json ...
    this.firstWatch = false
  }

  public async stop(): Promise<void> {
    if (!this.watching) {
      return
    }

    await this.fileWatcher.stop()
    this.callback = undefined
    this.watching = false
  }

  private async handleFileEvent(event: FileEvent): Promise<void> {
    try {
      if (event.type !== 'add' && event.type !== 'change') {
        return
      }

      // Skip already-processed add events on subsequent watches
      if (!this.firstWatch && event.type === 'add' && this.processedAddFiles.has(event.path)) {
        return
      }

      // Track add events to avoid re-processing
      if (event.type === 'add') {
        this.processedAddFiles.add(event.path)
      }

      const sessions = await this.parser.parseLogFile()

      if (this.callback !== undefined) {
        for (const session of sessions) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await this.callback(session)
          } catch (error) {
            console.error(`[CodingAgentLogWatcher] Error in session callback: ${error}`)
          }
        }
      }
    } catch (error) {
      console.error(`[CodingAgentLogWatcher] Error processing file ${event.path}: ${error}`)
    }
  }
}
