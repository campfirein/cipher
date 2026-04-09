import type {QueryLogEntry} from '../core/domain/entities/query-log-entry.js'

export function formatDuration(startedAt: number, completedAt?: number): string {
  if (completedAt === undefined) return '—'
  const delta = completedAt - startedAt
  if (delta < 1000) return `${delta}ms`
  return `${(delta / 1000).toFixed(1)}s`
}

export function formatEntryDuration(entry: QueryLogEntry): string {
  if (entry.status !== 'completed') return '—'
  return formatDuration(entry.startedAt, entry.completedAt)
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}
