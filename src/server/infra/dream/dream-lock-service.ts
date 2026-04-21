import {mkdir, readFile, stat, unlink, utimes, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

const LOCK_FILENAME = 'dream.lock'
const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

type DreamLockServiceOptions = {
  baseDir: string
  staleTimeoutMs?: number
}

/**
 * PID-based lock for dream execution.
 *
 * Lock file contains the owning process PID. Staleness is determined by mtime.
 * Uses write-then-verify to handle race conditions between concurrent acquirers.
 */
export class DreamLockService {
  private readonly lockFilePath: string
  private readonly staleTimeoutMs: number

  constructor(opts: DreamLockServiceOptions) {
    this.lockFilePath = join(opts.baseDir, LOCK_FILENAME)
    this.staleTimeoutMs = opts.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS
  }

  /** Clear PID content but keep the file. mtime becomes "last dream completion time". */
  async release(): Promise<void> {
    await writeFile(this.lockFilePath, '', 'utf8')
  }

  /**
   * Restore mtime after a failed dream so the time gate isn't fooled.
   * If priorMtime is 0 (lock didn't exist before), delete the file.
   */
  async rollback(priorMtime: number): Promise<void> {
    if (priorMtime === 0) {
      await unlink(this.lockFilePath).catch(() => {})
      return
    }

    await writeFile(this.lockFilePath, '', 'utf8')
    const time = new Date(priorMtime)
    await utimes(this.lockFilePath, time, time)
  }

  /**
   * Try to acquire the dream lock.
   *
   * Returns `{ acquired: true, priorMtime }` on success, where priorMtime
   * is the lock file's mtime before acquisition (0 if file didn't exist).
   *
   * Returns `{ acquired: false }` if another live, non-stale process holds the lock.
   */
  async tryAcquire(): Promise<{acquired: false} | {acquired: true; priorMtime: number}> {
    let priorMtime = 0

    try {
      const lockStat = await stat(this.lockFilePath)
      priorMtime = lockStat.mtimeMs

      const content = await readFile(this.lockFilePath, 'utf8')
      const pid = Number.parseInt(content.trim(), 10)

      if (!Number.isNaN(pid) && pid > 0) {
        const alive = isProcessAlive(pid)
        const stale = Date.now() - lockStat.mtimeMs > this.staleTimeoutMs

        if (alive && !stale) {
          return {acquired: false}
        }
      }
    } catch {
      // File doesn't exist — priorMtime stays 0
    }

    // Write our PID
    await mkdir(dirname(this.lockFilePath), {recursive: true})
    await writeFile(this.lockFilePath, String(process.pid), 'utf8')

    // Write-then-verify: re-read to confirm we won the race
    try {
      const content = await readFile(this.lockFilePath, 'utf8')
      if (content.trim() !== String(process.pid)) {
        return {acquired: false}
      }
    } catch {
      return {acquired: false}
    }

    return {acquired: true, priorMtime}
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM: process exists but we can't signal it — treat as alive
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    return false
  }
}
