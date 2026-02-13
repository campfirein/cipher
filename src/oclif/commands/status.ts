import {Args, Command, Flags} from '@oclif/core'

import type {IStatusUseCase} from '../../server/core/interfaces/usecase/i-status-use-case.js'

import {ProjectConfigStore} from '../../server/infra/config/file-config-store.js'
import {FileContextTreeService} from '../../server/infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../server/infra/context-tree/file-context-tree-snapshot-service.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {HeadlessTerminal} from '../../server/infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../server/infra/terminal/oclif-terminal.js'
import {StatusUseCase} from '../../server/infra/usecase/status-use-case.js'

export default class Status extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description =
    'Show CLI status and project information. Display local context tree managed by ByteRover CLI'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Check status after login (in REPL):',
    '/login',
    '/status',
    '',
    '# Verify project initialization (in REPL):',
    '/init',
    '/status',
    '',
    '<%= config.bin %> <%= command.id %> /path/to/project',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    headless: Flags.boolean({
      default: false,
      description: 'Run in headless mode (no TTY required, suitable for automation)',
    }),
  }

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): IStatusUseCase {
    const tokenStore = createTokenStore()
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    return new StatusUseCase({
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService,
      projectConfigStore: new ProjectConfigStore(),
      terminal,
      tokenStore,
    })
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const format = flags.format as 'json' | 'text'
    const {headless} = flags

    await this.createUseCase({format, headless}).run({cliVersion: this.config.version, format})
  }
}
