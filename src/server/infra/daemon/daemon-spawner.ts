import {spawn} from 'node:child_process'
import {unlinkSync} from 'node:fs'
import {dirname, join, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {DaemonInstanceInfo} from '../../core/interfaces/daemon/i-global-instance-manager.js'

import {DAEMON_INSTANCE_FILE, DAEMON_READY_POLL_INTERVAL_MS, DAEMON_READY_TIMEOUT_MS, HEARTBEAT_FILE} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {isProcessAlive} from '../instance/process-utils.js'
import {discoverDaemon} from './daemon-discovery.js'
import {GlobalInstanceManager} from './global-instance-manager.js'
import {SpawnLock} from './spawn-lock.js'

export type EnsureDaemonResult =
  | {info: Pick<DaemonInstanceInfo, 'pid' | 'port'>; started: boolean; success: true}
  | {reason: 'timeout'; spawnError?: string; success: false}

/**
 * Ensures a daemon is running, spawning one if needed.
 *
 * Flow:
 * 1. Check if daemon is already running (fast path, no lock needed)
 * 2. Acquire spawn lock (all mutations happen under lock)
 * 3. If lock held → wait for daemon to appear
 * 4. Re-check after lock (race window between step 1 and lock)
 * 5. Handle version mismatch → gracefully stop old daemon
 * 6. Clean up stale files
 * 7. Spawn daemon as detached process
 * 8. Poll until daemon is ready
 * 9. Release lock in finally block
 */
export async function ensureDaemonRunning(options?: {
  dataDir?: string
  timeoutMs?: number
  version?: string
}): Promise<EnsureDaemonResult> {
  const dataDir = options?.dataDir ?? getGlobalDataDir()
  const timeoutMs = options?.timeoutMs ?? DAEMON_READY_TIMEOUT_MS
  const version = options?.version
  const instanceManager = new GlobalInstanceManager({dataDir})

  // 1. Fast path: daemon already running and healthy — no lock needed
  const status = discoverDaemon({dataDir, expectedVersion: version, instanceManager})
  if (status.running) {
    return {info: {pid: status.pid, port: status.port}, started: false, success: true}
  }

  // 2. Acquire spawn lock — all mutations (kill, cleanup, spawn) happen under lock
  // to prevent concurrent processes from deleting each other's files.
  const lock = new SpawnLock({dataDir})
  const lockResult = lock.acquire()

  if (!lockResult.acquired) {
    // 3. Another client is spawning — wait for daemon to appear
    const info = await pollForDaemon(dataDir, timeoutMs, instanceManager, version)
    if (!info) return {reason: 'timeout', success: false}
    return {info, started: false, success: true}
  }

  try {
    // 4. Re-check after lock (race window between step 1 and lock acquisition)
    const recheck = discoverDaemon({dataDir, expectedVersion: version, instanceManager})
    if (recheck.running) {
      return {info: {pid: recheck.pid, port: recheck.port}, started: false, success: true}
    }

    // 5. Handle version mismatch: gracefully stop old daemon (safe — we hold the lock)
    if (!recheck.running && recheck.reason === 'version_mismatch') {
      await gracefullyStopDaemon(recheck.pid, timeoutMs)
    }

    // 6. Clean up stale files (safe — we hold the lock and confirmed no live daemon)
    cleanupStaleDaemonFiles(dataDir)

    // 7. Spawn daemon process
    const {getSpawnError} = spawnDaemonProcess()

    // 8. Wait for daemon to become ready
    const info = await pollForDaemon(dataDir, timeoutMs, instanceManager, version)
    if (!info) {
      const spawnError = getSpawnError()
      return {reason: 'timeout', spawnError: spawnError?.message, success: false}
    }

    return {info, started: true, success: true}
  } finally {
    lock.release()
  }
}

function spawnDaemonProcess(): {getSpawnError: () => Error | undefined} {
  let spawnError: Error | undefined
  const serverMainPath = resolveServerMainPath()

  const child = spawn(process.execPath, [serverMainPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => {
    spawnError = error
  })
  child.unref()
  return {getSpawnError: () => spawnError}
}

/**
 * Resolves the compiled server-main.js path.
 *
 * Same pattern as ProcessManager.getWorkerDir():
 * In dev mode (tsx), import.meta.url points to src/ — redirect to dist/.
 * In production, import.meta.url points to dist/ — use directly.
 */
export function resolveServerMainPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  if (currentDir.includes(`${sep}src${sep}`)) {
    return join(currentDir.replace(`${sep}src${sep}`, `${sep}dist${sep}`), 'server-main.js')
  }

  return join(currentDir, 'server-main.js')
}

async function pollForDaemon(
  dataDir: string,
  timeoutMs: number,
  instanceManager: GlobalInstanceManager,
  expectedVersion?: string,
): Promise<Pick<DaemonInstanceInfo, 'pid' | 'port'> | undefined> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const status = discoverDaemon({dataDir, expectedVersion, instanceManager})
    if (status.running) {
      return {pid: status.pid, port: status.port}
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(DAEMON_READY_POLL_INTERVAL_MS)
  }

  return undefined
}

/**
 * Sends SIGTERM to a daemon and waits for it to exit.
 * Used when version mismatch requires a graceful restart.
 */
async function gracefullyStopDaemon(pid: number, timeoutMs: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process already dead — nothing to do
    return
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    // eslint-disable-next-line no-await-in-loop
    await sleep(DAEMON_READY_POLL_INTERVAL_MS)
  }
}

/**
 * Best-effort cleanup of stale daemon files.
 * Called when a previous daemon is dead, has stale heartbeat, or was just stopped.
 *
 * Only cleans daemon.json and heartbeat — NOT spawn.lock.
 * The spawn lock is a client coordination mechanism with its own stale detection.
 */
function cleanupStaleDaemonFiles(dataDir: string): void {
  const files = [DAEMON_INSTANCE_FILE, HEARTBEAT_FILE]
  for (const file of files) {
    try {
      unlinkSync(join(dataDir, file))
    } catch {
      // File may not exist — ignore
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
