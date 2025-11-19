import {Command, Flags} from '@oclif/core'

import type {IFileWatcherService} from '../core/interfaces/i-file-watcher-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'

import {Agent} from '../core/domain/entities/agent.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {CleanParserServiceFactory} from '../infra/parsers/clean/clean-parser-service-factory.js'
import {RawParserServiceFactory} from '../infra/parsers/raw/raw-parser-service-factory.js'
import {FileWatcherService} from '../infra/watcher/file-watcher-service.js'

export default class Watch extends Command {
  public static description = 'Watch file system directories for changes and trigger parsing pipeline'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --paths ./agent-logs',
    '<%= config.bin %> <%= command.id %> --paths ./logs,./outputs,./workspace',
    '<%= config.bin %> <%= command.id %> -p ./src,./lib',
    '# Use chat log path from config (if IDE was configured during init):',
    '<%= config.bin %> <%= command.id %>',
  ]
  public static flags = {
    clean: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Run clean parsing after raw parsing (default: true)',
    }),
    debounce: Flags.integer({
      default: 2000,
      description: 'Debounce time in milliseconds before triggering parsing (default: 2000)',
    }),
    paths: Flags.string({
      char: 'p',
      description: 'Comma-separated list of directories to watch (defaults to configured chat log path)',
      required: false,
    }),
  }
  private lastParseTime = 0
  private parsingInProgress = false
  private pendingParse = false

  protected createServices(): {
    fileWatcherService: IFileWatcherService
    projectConfigStore: IProjectConfigStore
  } {
    return {
      fileWatcherService: new FileWatcherService(),
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Watch)
    const {fileWatcherService, projectConfigStore} = this.createServices()

    let paths: string[] = []
    let ideConfig: Agent | null = null

    // Use explicit paths if provided
    if (flags.paths) {
      paths = flags.paths.split(',').map((p) => p.trim())
    } else {
      // Try to load chat log path from config
      try {
        const configExists = await projectConfigStore.exists()
        if (configExists) {
          const config = await projectConfigStore.read()
          if (config?.chatLogPath && config?.ide) {
            paths = [config.chatLogPath]
            ideConfig = config.ide
            this.log(`ℹ Using chat log path from config (${config.ide})`)
          }
        }
      } catch {
        // Silently ignore config loading errors
      }

      if (paths.length === 0) {
        this.error(
          'No paths specified. Either:\n' +
            '  1. Use --paths flag: brv watch --paths ./logs,./outputs\n' +
            '  2. Run "brv init" to configure IDE and detect workspaces',
        )
      }
    }

    try {
      // Set up file event handler with parsing pipeline
      fileWatcherService.setFileEventHandler((event) => {
        this.log(`[${event.type}] ${event.path}`)

        // Only trigger parsing if IDE is configured
        if (ideConfig && (event.type === 'add' || event.type === 'change' || event.type === 'unlink')) {
          this.pendingParse = true

          // Debounce parsing to avoid too frequent triggers
          if (!this.parsingInProgress && Date.now() - this.lastParseTime > flags.debounce) {
            this.triggerParsing(ideConfig, paths[0]).catch((error) => {
              this.warn(`⚠️ Parsing error: ${error instanceof Error ? error.message : String(error)}`)
            })
          }
        }
      })

      await fileWatcherService.start(paths)
      this.log(`\n🔍 Watching paths: ${paths.join(', ')}`)
      if (ideConfig) {
        this.log(`📊 Parsing pipeline enabled for: ${ideConfig}`)
      }

      this.log('Press Ctrl+C to stop...\n')
      await this.waitForShutdownSignal()
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unknown Error')
    } finally {
      await fileWatcherService.stop()
    }
  }

  protected async waitForShutdownSignal(): Promise<void> {
    return new Promise<void>((resolve) => {
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

  private async triggerParsing(ide: Agent, chatLogPath: string): Promise<void> {
    if (this.parsingInProgress) {
      return
    }

    this.parsingInProgress = true
    this.pendingParse = false
    this.lastParseTime = Date.now()

    try {
      // Normalize IDE name for factory
      // Validate IDE is supported
      if (!RawParserServiceFactory.isSupported(ide)) {
        this.warn(`⚠️ Unsupported IDE: ${ide}`)
        return
      }

      this.log('\n📥 Parsing triggered...')
      // Raw parsing phase
      let isRawSuccess = false
      try {
        // Cast is safe because we already validated with isSupported()
         
         isRawSuccess = await RawParserServiceFactory.parseConversations(ide, chatLogPath)
      } catch (error) {
        this.warn(`⚠️ Raw parsing error: ${error instanceof Error ? error.message : String(error)}`)
        return
      }

      // Clean parsing phase (if enabled)
      const {flags} = await this.parse(Watch)
      if (isRawSuccess && flags.clean) {
        try {
          const rawOutputDir = `${process.cwd()}/.brv/logs/${ide}/raw`
          const isCleanSuccess = await CleanParserServiceFactory.parseConversations(ide, rawOutputDir)
          if (isCleanSuccess) {
            this.log('✅ Clean parsing complete\n')
          } else {
            this.warn('⚠️ Clean parsing failed')
          }
        } catch (error) {
          this.warn(`⚠️ Clean parsing error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      this.parsingInProgress = false

      // If more files were added while parsing, queue another parse
      if (this.pendingParse) {
        this.triggerParsing(ide, chatLogPath).catch((error) => {
          this.warn(`⚠️ Parsing error: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
  }
}
