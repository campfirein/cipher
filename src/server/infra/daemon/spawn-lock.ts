import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

import {z} from 'zod'

import type {ISpawnLock, SpawnLockAcquireResult} from '../../core/interfaces/daemon/i-spawn-lock.js'

import {SPAWN_LOCK_FILE, SPAWN_LOCK_STALE_THRESHOLD_MS} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {isProcessAlive} from '../instance/process-utils.js'

export type {SpawnLockAcquireResult} from '../../core/interfaces/daemon/i-spawn-lock.js'

const SpawnLockDataSchema = z.object({
  pid: z.number(),
  timestamp: z.number(),
})

type SpawnLockData = z.infer<typeof SpawnLockDataSchema>

function isValidSpawnLockData(value: unknown): value is SpawnLockData {
  return SpawnLockDataSchema.safeParse(value).success
}

/**
 * File-based spawn lock to prevent multiple clients from
 * spawning multiple daemon processes simultaneously.
 *
 * Uses atomic temp+rename pattern (same as GlobalInstanceManager).
 *
 * Lock is considered stale (can be overwritten) if:
 * - PID is dead
 * - Timestamp is older than 30s
 * - File is corrupted or missing
 */
export class SpawnLock implements ISpawnLock {
  private acquired = false
  private readonly lockPath: string

  constructor(options?: {dataDir?: string}) {
    const dataDir = options?.dataDir ?? getGlobalDataDir()
    this.lockPath = join(dataDir, SPAWN_LOCK_FILE)
  }

  acquire(): SpawnLockAcquireResult {
    if (this.isLockHeld()) {
      return {acquired: false, reason: 'held_by_another_process'}
    }

    const tempPath = `${this.lockPath}.${process.pid}.tmp`
    const data: SpawnLockData = {pid: process.pid, timestamp: Date.now()}

    // Ensure directory exists (matches GlobalInstanceManager.acquire() pattern)
    mkdirSync(dirname(this.lockPath), {recursive: true})

    try {
      writeFileSync(tempPath, JSON.stringify(data))
      renameSync(tempPath, this.lockPath)
    } catch {
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup error
      }

      return {acquired: false, reason: 'write_failed'}
    }

    // Read-back verification: defend against concurrent rename race.
    // Two processes can both rename successfully (POSIX rename is atomic
    // but overwrites silently). Verify our PID is actually in the file.
    if (!this.verifyOwnership()) {
      return {acquired: false, reason: 'held_by_another_process'}
    }

    this.acquired = true
    return {acquired: true}
  }

  release(): void {
    if (!this.acquired) return
    try {
      unlinkSync(this.lockPath)
    } catch {
      // Best-effort delete
    }

    this.acquired = false
  }

  private isLockHeld(): boolean {
    try {
      const content = readFileSync(this.lockPath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (!isValidSpawnLockData(parsed)) return false

      // Stale if PID is dead
      if (!isProcessAlive(parsed.pid)) return false

      // Stale if older than threshold
      if (Date.now() - parsed.timestamp > SPAWN_LOCK_STALE_THRESHOLD_MS) return false

      return true
    } catch {
      return false
    }
  }

  private verifyOwnership(): boolean {
    try {
      const content = readFileSync(this.lockPath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (!isValidSpawnLockData(parsed)) return false
      return parsed.pid === process.pid
    } catch {
      return false
    }
  }
}
