import type {ParsedInteraction} from '../../../core/domain/cipher/parsed-interaction.js'
import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {ICodingAgentLogWatcher} from '../../../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import type {FileEvent, IFileWatcherService} from '../../../core/interfaces/i-file-watcher-service.js'

type OnInteractionCallback = (interaction: ParsedInteraction) => Promise<void>

export class CodingAgentLogWatcher implements ICodingAgentLogWatcher {
  private callback: OnInteractionCallback | undefined
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

  public async start(options: {onInteraction: OnInteractionCallback; paths: string[]}): Promise<void> {
    if (this.watching) {
      throw new Error('Already watching. Stop the watcher before starting again.')
    }

    this.callback = options.onInteraction
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

      if (!this.parser.isValidLogFile(event.path)) {
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

      const interactions = await this.parser.parseLogFile(event.path)

      if (this.callback !== undefined) {
        for (const interaction of interactions) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await this.callback(interaction)
          } catch (error) {
            console.error(`[CodingAgentLogWatcher] Error in interaction callback: ${error}`)
          }
        }
      }
    } catch (error) {
      console.error(`[CodingAgentLogWatcher] Error processing file ${event.path}: ${error}`)
    }
  }
}
