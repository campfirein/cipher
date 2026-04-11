import {findProjectRoot} from '@campfirein/brv-transport-client'
import {Command, Flags} from '@oclif/core'

import type {QueryLogSummaryFormat} from '../../../server/core/interfaces/usecase/i-query-log-summary-use-case.js'

import {FileQueryLogStore} from '../../../server/infra/storage/file-query-log-store.js'
import {QueryLogSummaryUseCase} from '../../../server/infra/usecase/query-log-summary-use-case.js'
import {getProjectDataDir} from '../../../server/utils/path-utils.js'
import {parseTimeFilter} from '../../lib/time-filter.js'

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000 // last 24h

const FORMAT_OPTIONS = ['text', 'json', 'narrative'] as const

export default class QueryLogSummary extends Command {
  static description = 'View aggregated query recall metrics (coverage, cache hit rate, top topics)'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --last 24h',
    '<%= config.bin %> <%= command.id %> --last 7d',
    '<%= config.bin %> <%= command.id %> --last 30d',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --format narrative',
    '<%= config.bin %> <%= command.id %> --since 2026-04-01 --before 2026-04-03',
  ]
  static flags = {
    before: Flags.string({
      description: 'Entries before (ISO date or relative: 1h, 24h, 7d, 2w)',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: FORMAT_OPTIONS,
    }),
    last: Flags.string({
      description: 'Relative time window (e.g., 1h, 24h, 7d, 30d). Default: 24h',
    }),
    since: Flags.string({
      description: 'Entries after (ISO date or relative: 1h, 24h, 7d, 2w)',
    }),
  }

  protected createDependencies(baseDir: string) {
    const store = new FileQueryLogStore({baseDir})
    const useCase = new QueryLogSummaryUseCase({
      queryLogStore: store,
      terminal: {log: (m) => this.log(m ?? '')},
    })
    return {useCase}
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(QueryLogSummary)

    const after = this.resolveAfter(flags)
    const before = flags.before ? this.parseTime(flags.before, '--before') : undefined
    const format: QueryLogSummaryFormat =
      flags.format === 'json' || flags.format === 'narrative' ? flags.format : 'text'

    const projectRoot = (await findProjectRoot(process.cwd())) ?? process.cwd()
    const baseDir = getProjectDataDir(projectRoot)
    const {useCase} = this.createDependencies(baseDir)

    await useCase.run({
      ...(after === undefined ? {} : {after}),
      ...(before === undefined ? {} : {before}),
      format,
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

  private resolveAfter(flags: {before?: string; last?: string; since?: string}): number | undefined {
    if (flags.last) {
      return this.parseTime(flags.last, '--last')
    }

    if (flags.since) {
      return this.parseTime(flags.since, '--since')
    }

    // Default to last 24h only when NO time flag is provided at all.
    // If only --before is given, leave after undefined (all time before X).
    if (!flags.before) {
      return Date.now() - DEFAULT_WINDOW_MS
    }

    return undefined
  }

}
