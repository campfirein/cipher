import {Command} from '@oclif/core'

import type {ICodingAgentLogParser} from '../core/interfaces/cipher/i-coding-agent-log-parser.js'
import type {ICodingAgentLogWatcher} from '../core/interfaces/cipher/i-coding-agent-log-watcher.js'
import type {IFileWatcherService} from '../core/interfaces/i-file-watcher-service.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../core/interfaces/i-terminal.js'

import {isDevelopment} from '../config/environment.js'
import {CodingAgentLogParser} from '../infra/cipher/parsers/coding-agent-log-parser.js'
import {CodingAgentLogWatcher} from '../infra/cipher/watcher/coding-agent-log-watcher.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {FileWatcherService} from '../infra/watcher/file-watcher-service.js'

export default class Foo extends Command {
  public static description = 'Purely for testing CodingAgentLogWatcher [Development only]'
  public static hidden = !isDevelopment()
  protected terminal: ITerminal = {} as ITerminal

  protected async createServices(): Promise<{
    codingAgentLogWatcher: ICodingAgentLogWatcher
    projectConfigStore: IProjectConfigStore
  }> {
    this.terminal = new OclifTerminal(this)
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
    const {codingAgentLogWatcher, projectConfigStore} = await this.createServices()

    if (!isDevelopment()) {
      this.terminal.error('This command is only available in development environment')
      return
    }

    const projectConfig = await projectConfigStore.read()
    if (projectConfig === undefined) {
      this.terminal.error('No project config found. Run "brv init" first.')
      return
    }

    // Defensive checking nill
    if (projectConfig.chatLogPath === undefined) {
      this.terminal.error('No chat log path configured in project config. Run "brv init" first.')
    }

    if (projectConfig.ide === undefined) {
      this.terminal.error('No coding agent selected. Run "brv init" first.')
    }

    this.terminal.log(`Watching ${projectConfig.ide} log files...`)
    await codingAgentLogWatcher.start({
      codingAgentInfo: {
        chatLogPath: projectConfig.chatLogPath,
        name: projectConfig.ide,
      },
      onCleanSession: (cleanSession) =>
        new Promise<void>((resolve) => {
          this.terminal.log(`New Clean Session from ${cleanSession.type}:`)
          this.terminal.log(`Clean Session title: ${cleanSession.title}`)
          this.terminal.log('Clean Session messages:')
          for (const message of cleanSession.messages) {
            this.terminal.log(`${JSON.stringify(message, undefined, 2)}]\n`)
          }

          this.terminal.log(`Clean Session ID: ${cleanSession.id}`)
          this.terminal.log(`Clean Session Metadata: ${JSON.stringify(cleanSession.metadata, undefined, 2)}`)
          resolve()
          this.terminal.log(`Clean Session timestamp: ${cleanSession.timestamp}`)

          this.terminal.log(`Clean Session workspace paths:`)
          for (const workspacePath of cleanSession.workspacePaths) {
            this.terminal.log(`${workspacePath}`)
          }

          this.terminal.log('\n\n')
        }),
    })
  }
}
