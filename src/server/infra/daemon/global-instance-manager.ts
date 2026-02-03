import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'

import type {
  DaemonAcquireResult,
  DaemonInstanceInfo,
  IGlobalInstanceManager,
} from '../../core/interfaces/daemon/i-global-instance-manager.js'

import {DAEMON_INSTANCE_FILE} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {isProcessAlive} from '../../utils/process-utils.js'

export type {DaemonAcquireResult, DaemonInstanceInfo} from '../../core/interfaces/daemon/i-global-instance-manager.js'

/**
 * Zod schema for validating parsed JSON as DaemonInstanceInfo.
 */
const DaemonInstanceInfoSchema = z.object({
  pid: z.number(),
  port: z.number(),
  startedAt: z.number(),
  version: z.string(),
})

function isValidDaemonInstanceInfo(value: unknown): value is DaemonInstanceInfo {
  return DaemonInstanceInfoSchema.safeParse(value).success
}

/**
 * Manages the global daemon instance file at ~/.local/share/brv/daemon.json.
 *
 * Key difference from FileInstanceManager:
 * - Operates on a single global path (not per-project)
 * - Uses atomic writes (temp file + rename) to prevent TOCTOU races
 * - Synchronous I/O for critical section reliability
 */
export class GlobalInstanceManager implements IGlobalInstanceManager {
  private readonly dataDir: string
  private readonly instancePath: string

  constructor(options?: {dataDir?: string}) {
    this.dataDir = options?.dataDir ?? getGlobalDataDir()
    this.instancePath = join(this.dataDir, DAEMON_INSTANCE_FILE)
  }

  /**
   * Attempts to acquire the daemon instance lock.
   *
   * If an existing instance is running (live PID), returns acquired: false.
   * If stale or no instance, writes new daemon.json atomically and returns acquired: true.
   */
  acquire(port: number, version: string): DaemonAcquireResult {
    const existing = this.load()
    if (existing && isProcessAlive(existing.pid)) {
      return {acquired: false, existingInstance: existing, reason: 'already_running'}
    }

    const instance: DaemonInstanceInfo = {
      pid: process.pid,
      port,
      startedAt: Date.now(),
      version,
    }

    // Ensure directory exists
    mkdirSync(this.dataDir, {recursive: true})

    // Atomic write: temp file → rename
    // NOTE: Unlike SpawnLock, no read-back verification is needed here.
    // acquire() is only called from the daemon process itself (server-main.ts),
    // which is protected by the spawn lock — only one daemon can be spawning at a time.
    const tempPath = this.instancePath + '.tmp.' + process.pid
    try {
      writeFileSync(tempPath, JSON.stringify(instance, null, 2))
      renameSync(tempPath, this.instancePath)
    } catch {
      // Clean up temp file on failure
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup error
      }

      return {acquired: false, reason: 'write_failed'}
    }

    return {acquired: true, instance}
  }

  /**
   * Loads the daemon instance info from disk.
   * Returns undefined if file is missing, corrupted, or has invalid schema.
   */
  load(): DaemonInstanceInfo | undefined {
    try {
      const content = readFileSync(this.instancePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (isValidDaemonInstanceInfo(parsed)) {
        return parsed
      }

      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * Releases the daemon instance lock by deleting daemon.json.
   *
   * Only deletes if the file's PID matches the current process to prevent
   * accidentally removing another daemon's instance file during overlapping
   * shutdown/startup sequences.
   */
  release(): void {
    try {
      const existing = this.load()
      if (existing && existing.pid !== process.pid) {
        return
      }

      unlinkSync(this.instancePath)
    } catch {
      // Best-effort delete
    }
  }
}
