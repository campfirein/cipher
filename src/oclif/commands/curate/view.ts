import {findProjectRoot} from '@campfirein/brv-transport-client'
import {Args, Command, Flags} from '@oclif/core'

import type {CurateLogStatus} from '../../../server/core/interfaces/storage/i-curate-log-store.js'

import {FileCurateLogStore} from '../../../server/infra/storage/file-curate-log-store.js'
import {CurateLogUseCase} from '../../../server/infra/usecase/curate-log-use-case.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'

const VALID_STATUSES: CurateLogStatus[] = ['cancelled', 'completed', 'error', 'processing']

const RELATIVE_TIME_PATTERN = /^(\d+)(m|h|d|w)$/

/**
 * Parse a time filter value into a UTC millisecond timestamp.
 *
 * Accepts:
 *  - Relative: "30m", "1h", "24h", "7d", "2w"
 *  - Absolute: ISO date "2024-01-15" or datetime "2024-01-15T12:00:00Z"
 *
 * Returns null when the value cannot be parsed.
 */
function parseTimeFilter(value: string): null | number {
  const relMatch = RELATIVE_TIME_PATTERN.exec(value)
  if (relMatch) {
    const amount = Number(relMatch[1])
    const unit = relMatch[2]
    const multipliers: Record<string, number> = {d: 86_400_000, h: 3_600_000, m: 60_000, w: 604_800_000}
    return Date.now() - amount * multipliers[unit]
  }

  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : ts
}

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
      description: 'Show entries started before this time (ISO date or relative: 1h, 24h, 7d, 2w)',
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
      description: 'Show entries started after this time (ISO date or relative: 1h, 24h, 7d, 2w)',
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

    const projectRoot = (await findProjectRoot(process.cwd())) ?? process.cwd()
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
      status: flags.status as CurateLogStatus[] | undefined,
    })
  }

  private parseTime(value: string, flagName: string): number {
    const ts = parseTimeFilter(value)
    if (ts === null) {
      this.error(
        `Invalid time value for ${flagName}: "${value}". Use ISO date (2024-01-15) or relative (1h, 24h, 7d, 2w).`,
        {exit: 2},
      )
    }

    return ts
  }
}
