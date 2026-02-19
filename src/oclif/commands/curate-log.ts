import {findProjectRoot} from '@campfirein/brv-transport-client'
import {Args, Command, Flags} from '@oclif/core'

import {FileCurateLogStore} from '../../server/infra/storage/file-curate-log-store.js'
import {CurateLogUseCase} from '../../server/infra/usecase/curate-log-use-case.js'
import {getProjectDataDir} from '../../server/utils/path-utils.js'

export default class CurateLog extends Command {
  static args = {
    id: Args.string({
      description: 'Log entry ID to view in detail',
      required: false,
    }),
  }
  static description = 'View curate history'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> cur-1739700001000',
    '<%= config.bin %> <%= command.id %> --limit 20',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    limit: Flags.integer({
      default: 10,
      description: 'Maximum number of log entries to display',
      min: 1,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(CurateLog)

    const projectRoot = (await findProjectRoot(process.cwd())) ?? process.cwd()
    const baseDir = getProjectDataDir(projectRoot)
    const store = new FileCurateLogStore({baseDir})
    const useCase = new CurateLogUseCase({
      curateLogStore: store,
      terminal: {log: (m) => this.log(m ?? '')},
    })

    await useCase.run({
      format: flags.format as 'json' | 'text',
      id: args.id,
      limit: flags.limit,
    })
  }
}
