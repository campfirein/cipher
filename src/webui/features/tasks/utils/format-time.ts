/**
 * Time / duration formatting helpers used by task list and detail views.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatRelative(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  return `${minutes}:${pad2(seconds)}`
}

export function formatTimeOfDay(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function shortTaskId(taskId: string): string {
  if (!taskId) return ''
  // Show the bare UUID prefix so it lines up with what the CLI prints
  // (e.g. `Task: e446bdcd-d082-...` → display `e446bdcd`).
  const trimmed = taskId.replace(/^task[_-]?/, '')
  return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed
}
