import {Command} from '@oclif/core'

import {isDevelopment} from '../config/environment.js'
import {ICodingAgentLogParser} from '../core/interfaces/cipher/i-coding-agent-log-parser.js'
import {ICodingAgentLogWatcher} from '../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import {IFileWatcherService} from '../core/interfaces/i-file-watcher-service.js'
import {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import {CodingAgentLogParser} from '../infra/cipher/parsers/coding-agent-log-parser.js'
import {CodingAgentLogWatcher} from '../infra/cipher/watcher/coding-agent-log-watcher.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileWatcherService} from '../infra/watcher/file-watcher-service.js'

export default class Foo extends Command {
  public static description = 'Purely for testing CodingAgentLogWatcher [Development only]'
  public static hidden = !isDevelopment()

  protected async createServices(): Promise<{
    codingAgentLogWatcher: ICodingAgentLogWatcher
    projectConfigStore: IProjectConfigStore
  }> {
    const projectConfigStore: IProjectConfigStore = new ProjectConfigStore()
    const fileWatcherService: IFileWatcherService = new FileWatcherService()
    const codingAgentLogParser: ICodingAgentLogParser = new CodingAgentLogParser()
    const codingAgentLogWatcher: ICodingAgentLogWatcher = new CodingAgentLogWatcher(
      fileWatcherService,
      codingAgentLogParser,
    )
    return {
      codingAgentLogWatcher,
      projectConfigStore,
    }
  }

  public async run(): Promise<void> {
    if (!isDevelopment()) {
      this.error('This command is only available in development environment')
    }

    const {codingAgentLogWatcher, projectConfigStore} = await this.createServices()
    const projectConfig = await projectConfigStore.read()
    if (projectConfig === undefined) {
      this.error('No project config found. Run "brv init" first.')
    }

    // Defensive checking nill
    if (projectConfig.chatLogPath === undefined) {
      this.error('No chat log path configured in project config. Run "brv init" first.')
    }

    if (projectConfig.ide === undefined) {
      this.error('No coding agent selected. Run "brv init" first.')
    }

    this.log(`Watching ${projectConfig.ide} log files...`)
    await codingAgentLogWatcher.start({
      codingAgentInfo: {
        chatLogPath: projectConfig.chatLogPath,
        name: projectConfig.ide,
      },
      onCleanSession: (cleanSession) =>
        new Promise<void>((resolve) => {
          this.log(`New Clean Session from ${cleanSession.type}:`)
          this.log(`Clean Session title: ${cleanSession.title}`)
          this.log('Clean Session messages:')
          for (const message of cleanSession.messages) {
            this.log(`${JSON.stringify(message, undefined, 2)}]\n`)
          }

          this.log(`Clean Session ID: ${cleanSession.id}`)
          this.log(`Clean Session Metadata: ${JSON.stringify(cleanSession.metadata, undefined, 2)}`)
          resolve()
          this.log(`Clean Session timestamp: ${cleanSession.timestamp}`)

          this.log(`Clean Session workspace paths:`)
          for (const workspacePath of cleanSession.workspacePaths) {
            this.log(`${workspacePath}`)
          }

          this.log('\n\n')
        }),
    })
  }
}
