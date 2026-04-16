import {Args, Command, Flags} from '@oclif/core'

import {QUERY_LOG_STATUSES, QUERY_LOG_TIERS, type QueryLogStatus, type QueryLogTier} from '../../../server/core/domain/entities/query-log-entry.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {FileQueryLogStore} from '../../../server/infra/storage/file-query-log-store.js'
import {QueryLogUseCase} from '../../../server/infra/usecase/query-log-use-case.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'
import {parseTimeFilter} from '../../lib/time-filter.js'

export default class QueryLogView extends Command {
  static args = {
    id: Args.string({
      description: 'Query log entry ID to view in detail',
      required: false,
    }),
  }
  static description = 'View query log history'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> qry-1712345678901',
    '<%= config.bin %> <%= command.id %> --limit 20',
    '<%= config.bin %> <%= command.id %> --status completed',
    '<%= config.bin %> <%= command.id %> --status completed --status error',
    '<%= config.bin %> <%= command.id %> --tier 0 --tier 1',
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
      description: 'Show matched docs for each entry',
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
      description: `Filter by status (can be repeated). Options: ${QUERY_LOG_STATUSES.join(', ')}`,
      multiple: true,
      options: QUERY_LOG_STATUSES,
    }),
    tier: Flags.string({
      description: `Filter by resolution tier (can be repeated). Options: ${QUERY_LOG_TIERS.join(', ')}`,
      multiple: true,
      options: QUERY_LOG_TIERS.map(String),
    }),
  }

  protected createDependencies(baseDir: string) {
    const store = new FileQueryLogStore({baseDir})
    const useCase = new QueryLogUseCase({
      queryLogStore: store,
      terminal: {log: (m) => this.log(m ?? '')},
    })
    return {useCase}
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(QueryLogView)

    const after = flags.since ? this.parseTime(flags.since, '--since') : undefined
    const before = flags.before ? this.parseTime(flags.before, '--before') : undefined
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const baseDir = getProjectDataDir(projectRoot)
    const {useCase} = this.createDependencies(baseDir)

    await useCase.run({
      after,
      before,
      detail: flags.detail,
      format,
      id: args.id,
      limit: flags.limit,
      status: flags.status?.filter((s): s is QueryLogStatus => (QUERY_LOG_STATUSES as readonly string[]).includes(s)),
      tier: flags.tier?.map(Number).filter((t): t is QueryLogTier => (QUERY_LOG_TIERS as readonly number[]).includes(t)),
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
