import type {CurateLogOperation, CurateLogSummary} from '../../core/domain/entities/curate-log-entry.js'
import type {CurateLogStatus, ICurateLogStore} from '../../core/interfaces/storage/i-curate-log-store.js'
import type {ICurateLogUseCase} from '../../core/interfaces/usecase/i-curate-log-use-case.js'

type Terminal = {log(msg?: string): void}

type CurateLogUseCaseDeps = {
  curateLogStore: ICurateLogStore
  terminal: Terminal
}

type ListOptions = {
  after?: number
  before?: number
  detail?: boolean
  format?: 'json' | 'text'
  limit?: number
  status?: CurateLogStatus[]
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

function formatSummary(summary: CurateLogSummary): string {
  const parts: string[] = []
  if (summary.added > 0) parts.push(`${summary.added} added`)
  if (summary.updated > 0) parts.push(`${summary.updated} updated`)
  if (summary.merged > 0) parts.push(`${summary.merged} merged`)
  if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`)
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function formatOperationLine(op: CurateLogOperation): string {
  const icon = op.status === 'success' ? '✓' : '✗'
  return `  ${icon} [${op.type}] ${op.path}${op.message ? ` — ${op.message}` : ''}`
}

// ── CurateLogUseCase ──────────────────────────────────────────────────────────

/**
 * Use case for displaying curate log entries.
 *
 * Reads directly from FileCurateLogStore — no daemon connection required.
 */
export class CurateLogUseCase implements ICurateLogUseCase {
  constructor(private readonly deps: CurateLogUseCaseDeps) {}

  async run({
    after,
    before,
    detail = false,
    format = 'text',
    id,
    limit = 10,
    status,
  }: {
    after?: number
    before?: number
    detail?: boolean
    format?: 'json' | 'text'
    id?: string
    limit?: number
    status?: CurateLogStatus[]
  }): Promise<void> {
    await (id
      ? this.showDetail(id, format)
      : this.showList({after, before, detail, format, limit, status}))
  }

  // ── Private methods ─────────────────────────────────────────────────────────

  private log(msg?: string): void {
    this.deps.terminal.log(msg)
  }

  private logJson(payload: {data: unknown; success: boolean}): void {
    this.log(JSON.stringify({command: 'curate view', ...payload, retrievedAt: new Date().toISOString()}, null, 2))
  }

  private async showDetail(id: string, format: 'json' | 'text'): Promise<void> {
    const entry = await this.deps.curateLogStore.getById(id)

    if (!entry) {
      if (format === 'json') {
        this.logJson({data: {error: `Log entry not found: ${id}`}, success: false})
      } else {
        this.log(`No curate log entry found with ID: ${id}`)
      }

      return
    }

    if (format === 'json') {
      this.logJson({data: entry, success: true})
      return
    }

    // Text format
    this.log(`ID:       ${entry.id}`)
    this.log(`Status:   ${entry.status}`)
    this.log(`Started:  ${formatTimestamp(entry.startedAt)}`)

    if (entry.status !== 'processing') {
      this.log(`Finished: ${formatTimestamp(entry.completedAt)}`)
    }

    this.log()
    this.log('Input:')
    if (entry.input.context) {
      const [firstLine, ...rest] = entry.input.context.split('\n')
      this.log(`  Context: ${firstLine}`)
      for (const line of rest) this.log(`  ${line}`)
    }

    if (entry.input.files?.length) this.log(`  Files:   ${entry.input.files.join(', ')}`)
    if (entry.input.folders?.length) this.log(`  Folders: ${entry.input.folders.join(', ')}`)

    if (entry.operations.length > 0) {
      this.log()
      this.log('Operations:')
      for (const op of entry.operations) {
        this.log(formatOperationLine(op))
      }
    }

    this.log()
    this.log(`Summary: ${formatSummary(entry.summary)}`)

    if (entry.status === 'error') {
      this.log()
      this.log(`Error: ${entry.error}`)
    }

    if (entry.status === 'completed' && entry.response) {
      this.log()
      this.log('Response:')
      this.log(entry.response.split('\n').map((line) => `  ${line}`).join('\n'))
    }
  }

  private async showList({after, before, detail, format, limit, status}: ListOptions): Promise<void> {
    const hasFilters = Boolean(after !== undefined || before !== undefined || status?.length)
    const entries = await this.deps.curateLogStore.list({
      ...(after === undefined ? {} : {after}),
      ...(before === undefined ? {} : {before}),
      limit,
      ...(status?.length ? {status} : {}),
    })

    if (format === 'json') {
      this.logJson({data: entries, success: true})
      return
    }

    if (entries.length === 0) {
      if (hasFilters) {
        this.log('No curate log entries found matching your filters.')
      } else {
        this.log('No curate log entries found.')
        this.log('Run "brv curate" to add context — logs are recorded automatically.')
      }

      return
    }

    // Table header
    const idWidth = 22
    const statusWidth = 12
    const opsWidth = 20
    const timeWidth = 20

    const header = [
      'ID'.padEnd(idWidth),
      'Status'.padEnd(statusWidth),
      'Operations'.padEnd(opsWidth),
      'Timestamp',
    ].join('  ')

    this.log(header)
    this.log('─'.repeat(idWidth + statusWidth + opsWidth + timeWidth + 6))

    for (const entry of entries) {
      const timestamp = entry.status === 'processing' ? '(processing...)' : formatTimestamp(entry.startedAt)
      const ops = entry.status === 'processing' ? '—' : formatSummary(entry.summary)
      const row = [entry.id.padEnd(idWidth), entry.status.padEnd(statusWidth), ops.padEnd(opsWidth), timestamp].join(
        '  ',
      )
      this.log(row)

      if (detail && entry.operations.length > 0) {
        for (const op of entry.operations) {
          this.log(formatOperationLine(op))
        }
      }
    }
  }
}
