import {Args, Command, Flags} from '@oclif/core'

import type {CurateLogStatus} from '../../../server/core/interfaces/storage/i-curate-log-store.js'

import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {FileCurateLogStore} from '../../../server/infra/storage/file-curate-log-store.js'
import {CurateLogUseCase} from '../../../server/infra/usecase/curate-log-use-case.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'
import {parseTimeFilter} from '../../lib/time-filter.js'

const VALID_STATUSES: CurateLogStatus[] = ['cancelled', 'completed', 'error', 'processing']

export default class CurateView extends Command {
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
    '<%= config.bin %> <%= command.id %> --status completed',
    '<%= config.bin %> <%= command.id %> --status completed --status error',
    '<%= config.bin %> <%= command.id %> --since 1h',
    '<%= config.bin %> <%= command.id %> --since 2024-01-15',
    '<%= config.bin %> <%= command.id %> --before 2024-02-01',
    '<%= config.bin %> <%= command.id %> --detail',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  static flags = {
    before: Flags.string({
      description: 'Show entries started before this time (ISO date or relative: 30m, 1h, 24h, 7d, 2w)',
    }),
    detail: Flags.boolean({
      default: false,
      description: 'Show operations for each entry in list view',
    }),
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
    since: Flags.string({
      description: 'Show entries started after this time (ISO date or relative: 30m, 1h, 24h, 7d, 2w)',
    }),
    status: Flags.string({
      description: `Filter by status (can be repeated). Options: ${VALID_STATUSES.join(', ')}`,
      multiple: true,
      options: VALID_STATUSES,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(CurateView)

    const after = flags.since ? this.parseTime(flags.since, '--since') : undefined
    const before = flags.before ? this.parseTime(flags.before, '--before') : undefined
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const baseDir = getProjectDataDir(projectRoot)
    const store = new FileCurateLogStore({baseDir})
    const useCase = new CurateLogUseCase({
      curateLogStore: store,
      terminal: {log: (m) => this.log(m ?? '')},
    })

    await useCase.run({
      after,
      before,
      detail: flags.detail,
      format,
      id: args.id,
      limit: flags.limit,
      status: flags.status?.filter((s): s is CurateLogStatus => (VALID_STATUSES as string[]).includes(s)),
    })
  }

  private parseTime(value: string, flagName: string): number {
    const ts = parseTimeFilter(value)
    if (ts === undefined) {
      this.error(
        `Invalid time value for ${flagName}: "${value}". Use ISO date (2024-01-15) or relative (30m, 1h, 24h, 7d, 2w).`,
        {exit: 2},
      )
    }

    return ts
  }
}
