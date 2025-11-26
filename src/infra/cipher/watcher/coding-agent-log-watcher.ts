import type {CleanSession} from '../../../core/domain/entities/parser.js'
import type {ICodingAgentLogParser} from '../../../core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {
  CodingAgentLogWatcherOptions,
  ICodingAgentLogWatcher,
} from '../../../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import type {FileEvent, IFileWatcherService} from '../../../core/interfaces/i-file-watcher-service.js'

type OnSessionCallback = (session: CleanSession) => Promise<void>

export class CodingAgentLogWatcher implements ICodingAgentLogWatcher {
  private callback: OnSessionCallback | undefined
  private readonly fileWatcher: IFileWatcherService
  private readonly parser: ICodingAgentLogParser
  private watching: boolean

  public constructor(fileWatcher: IFileWatcherService, parser: ICodingAgentLogParser) {
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

  // TODO: This method is moved from CipherAgent to here as a point of reference for the logic. Will handle it later.
  /**
   * Processes a clean external session between user and coding agent into context tree by calling LLM service.
   * @param cleanExternalSession The clean external session to process.
   */
  // public async processCleanExternalSession(cleanExternalSession: CleanSession): Promise<void> {
  //   // Cipher agent must be started because the log watcher starts with it.
  //   this.ensureStarted()
  //   const internalSessionId = `${cleanExternalSession.id}-process-${Date.now()}`
  //   try {
  //     const cleanExternalSessionJsonStr = JSON.stringify(cleanExternalSession, null, 2)
  //     const llmPrompt = `Process the following external coding session into the context tree:\n\n${cleanExternalSessionJsonStr}`
  //     this.getAgentEventBus().emit('cipher:cleanExternalSessionProcessing', {
  //       codingAgent: cleanExternalSession.type,
  //       externalSessionTitle: cleanExternalSession.title,
  //     })
  //     await this.execute(llmPrompt, internalSessionId, {
  //       executionContext: {
  //         commandType: 'add',
  //       },
  //       mode: 'autonomous',
  //     })
  //     this.getAgentEventBus().emit('cipher:cleanExternalSessionProcessed', {
  //       codingAgent: cleanExternalSession.type,
  //       externalSessionTitle: cleanExternalSession.title,
  //     })
  //   } catch (error) {
  //     this.getAgentEventBus().emit('cipher:cleanExternalSessionProcessingError', {
  //       codingAgent: cleanExternalSession.type,
  //       error: error instanceof Error ? error : new Error('Unknown error'),
  //       externalSessionTitle: cleanExternalSession.title,
  //     })
  //     console.error(`Error processing external session ${cleanExternalSession.id}:`, error)
  //   } finally {
  //     try {
  //       await this.deleteSession(internalSessionId)
  //     } catch (cleanupError) {
  //       console.error(`Error cleaning up processing session ${internalSessionId}:`, cleanupError)
  //     }
  //   }
  // }
}
