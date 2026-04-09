import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {IQueryLogStore, QueryLogStatus, QueryLogTier} from '../../core/interfaces/storage/i-query-log-store.js'
import type {IQueryLogUseCase} from '../../core/interfaces/usecase/i-query-log-use-case.js'

import {QUERY_LOG_TIER_LABELS} from '../../core/domain/entities/query-log-entry.js'
import {formatDuration, formatEntryDuration, formatTimestamp, truncate} from '../../utils/log-format-utils.js'

type QueryLogUseCaseDeps = {
  queryLogStore: IQueryLogStore
  terminal: ITerminal
}

type ListOptions = {
  after?: number
  before?: number
  detail?: boolean
  format?: 'json' | 'text'
  limit?: number
  status?: QueryLogStatus[]
  tier?: QueryLogTier[]
}

/**
 * Use case for displaying query log entries.
 *
 * Reads directly from FileQueryLogStore — no daemon connection required.
 */
export class QueryLogUseCase implements IQueryLogUseCase {
  constructor(private readonly deps: QueryLogUseCaseDeps) {}

  async run({
    after,
    before,
    detail = false,
    format = 'text',
    id,
    limit = 10,
    status,
    tier,
  }: {
    after?: number
    before?: number
    detail?: boolean
    format?: 'json' | 'text'
    id?: string
    limit?: number
    status?: QueryLogStatus[]
    tier?: QueryLogTier[]
  }): Promise<void> {
    await (id
      ? this.showDetail(id, format)
      : this.showList({after, before, detail, format, limit, status, tier}))
  }

  private log(msg?: string): void {
    this.deps.terminal.log(msg)
  }

  private logJson(payload: {data: unknown; success: boolean}): void {
    this.log(JSON.stringify({command: 'query view', ...payload, retrievedAt: new Date().toISOString()}, null, 2))
  }

  private async showDetail(id: string, format: 'json' | 'text'): Promise<void> {
    const entry = await this.deps.queryLogStore.getById(id)

    if (!entry) {
      if (format === 'json') {
        this.logJson({data: {error: `Log entry not found: ${id}`}, success: false})
      } else {
        this.log(`No query log entry found with ID: ${id}`)
      }

      return
    }

    if (format === 'json') {
      this.logJson({data: entry, success: true})
      return
    }

    this.log(`ID:       ${entry.id}`)
    this.log(`Status:   ${entry.status}`)
    this.log(`Tier:     ${entry.tier} (${QUERY_LOG_TIER_LABELS[entry.tier]})`)
    this.log(`Started:  ${formatTimestamp(entry.startedAt)}`)

    if (entry.status !== 'processing') {
      this.log(`Finished: ${formatTimestamp(entry.completedAt)}`)
      this.log(`Duration: ${formatDuration(entry.startedAt, entry.completedAt)}`)
    }

    this.log()
    this.log(`Query: ${entry.query}`)

    if (entry.status === 'completed' && entry.matchedDocs.length > 0) {
      this.log()
      this.log('Matched Documents:')
      for (const doc of entry.matchedDocs) {
        this.log(`  [${doc.score.toFixed(2)}] ${doc.path}`)
      }
    }

    if (entry.status === 'completed') {
      this.log()
      this.log('Search Metadata:')
      this.log(`  Results: ${entry.searchMetadata.resultsFound} of ${entry.searchMetadata.totalResults} found`)
      this.log(`  Top Score: ${entry.searchMetadata.topScore}`)
      if (entry.searchMetadata.cacheFingerprint) {
        this.log(`  Cache Fingerprint: ${entry.searchMetadata.cacheFingerprint}`)
      }
    }

    if (entry.status === 'error') {
      this.log()
      this.log(`Error: ${entry.error}`)
    }

    if (entry.status === 'completed' && entry.response) {
      this.log()
      this.log('Response (truncated):')
      this.log(`  ${truncate(entry.response, 500)}`)
    }
  }

  private async showList({after, before, detail, format, limit, status, tier}: ListOptions): Promise<void> {
    const hasFilters = Boolean(after !== undefined || before !== undefined || status?.length || tier?.length)
    const entries = await this.deps.queryLogStore.list({
      ...(after === undefined ? {} : {after}),
      ...(before === undefined ? {} : {before}),
      limit,
      ...(status?.length ? {status} : {}),
      ...(tier?.length ? {tier} : {}),
    })

    if (format === 'json') {
      this.logJson({data: entries, success: true})
      return
    }

    if (entries.length === 0) {
      if (hasFilters) {
        this.log('No query log entries found matching your filters.')
      } else {
        this.log('No query log entries found.')
      }

      return
    }

    const idWidth = 22
    const tierWidth = 6
    const statusWidth = 12
    const timeWidth = 8
    const queryWidth = 40

    const header = [
      'ID'.padEnd(idWidth),
      'Tier'.padEnd(tierWidth),
      'Status'.padEnd(statusWidth),
      'Time'.padEnd(timeWidth),
      'Query',
    ].join('  ')

    this.log(header)
    this.log('─'.repeat(idWidth + tierWidth + statusWidth + timeWidth + queryWidth + 8))

    for (const entry of entries) {
      const duration = formatEntryDuration(entry)
      const tierBadge = `T${entry.tier}`
      const query = truncate(entry.query, queryWidth)
      const row = [
        entry.id.padEnd(idWidth),
        tierBadge.padEnd(tierWidth),
        entry.status.padEnd(statusWidth),
        duration.padEnd(timeWidth),
        query,
      ].join('  ')
      this.log(row)

      if (detail && entry.status === 'completed' && entry.matchedDocs.length > 0) {
        for (const doc of entry.matchedDocs) {
          this.log(`  [${doc.score.toFixed(2)}] ${doc.path}`)
        }
      }
    }
  }
}
