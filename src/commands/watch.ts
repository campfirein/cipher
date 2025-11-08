import {Command, Flags} from '@oclif/core'

import type {IFileWatcherService} from '../core/interfaces/i-file-watcher-service.js'

import {FileWatcherService} from '../infra/watcher/file-watcher-service.js'

export default class Watch extends Command {
  public static description = 'Watch file system directories for changes and log events to stdout'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --paths ./agent-logs',
    '<%= config.bin %> <%= command.id %> --paths ./logs,./outputs,./workspace',
    '<%= config.bin %> <%= command.id %> -p ./src,./lib',
  ]
  public static flags = {
    paths: Flags.string({
      char: 'p',
      description: 'Comma-separated list of directories to watch',
      required: true,
    }),
  }

  protected createServices(): {
    fileWatcherService: IFileWatcherService
  } {
    return {
      fileWatcherService: new FileWatcherService(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Watch)
    const {fileWatcherService} = this.createServices()
    const paths = flags.paths.split(',').map((p) => p.trim())
    try {
      fileWatcherService.setFileEventHandler((event) => {
        this.log(`[${event.type}] ${event.path}`)
      })
      await fileWatcherService.start(paths)
      this.log(`Watching paths: ${paths.join(', ')}`)
      this.log('Press Ctrl+C to stop...')
      await this.waitForShutdownSignal()
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unknown Error')
    } finally {
      await fileWatcherService.stop()
    }
  }

  private async waitForShutdownSignal(): Promise<void> {
    return new Promise((resolve) => {
      const handleSignal = (): void => {
        this.log('\nShutting down watcher...')
        process.off('SIGINT', handleSignal)
        process.off('SIGTERM', handleSignal)
        resolve()
      }

      process.on('SIGINT', handleSignal)
      process.on('SIGTERM', handleSignal)
    })
  }
}
