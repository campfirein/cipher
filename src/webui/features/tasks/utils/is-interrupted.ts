type TaskError = {
  code?: string
  message: string
  name?: string
}

type Input = {
  error?: TaskError
  status: string
}

const INTERRUPTED_CODE = 'INTERRUPTED'
const INTERRUPTED_MESSAGE = 'Interrupted (daemon terminated)'

/**
 * Returns true when an `error`-status task represents a daemon-termination interrupt
 * rather than a genuine failure.
 *
 * Belt-and-suspenders: matches on both the canonical `error.code` and the legacy
 * `error.message` text, so entries written before the code field landed are still
 * recognised. Non-error statuses and entries without an error are never interrupted.
 */
export function isInterrupted(task: Input): boolean {
  if (task.status !== 'error') return false
  if (!task.error) return false
  if (task.error.code === INTERRUPTED_CODE) return true
  if (task.error.message === INTERRUPTED_MESSAGE) return true
  return false
}
