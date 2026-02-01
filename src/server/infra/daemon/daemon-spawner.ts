import {spawn} from 'node:child_process'
import {unlinkSync} from 'node:fs'
import {dirname, join, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {DaemonInstanceInfo, IGlobalInstanceManager} from '../../core/interfaces/daemon/i-global-instance-manager.js'

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
 * 5. Handle unhealthy daemon (version mismatch or stale heartbeat) → gracefully stop
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

  // Shared deadline for the entire operation — both stop + start share this budget.
  // Without a shared deadline, each sub-operation allocates its own full timeout,
  // making the total wait up to 2x timeoutMs.
  const deadline = Date.now() + timeoutMs

  if (!lockResult.acquired) {
    // 3. Another client is spawning — wait for daemon to appear
    const info = await pollForDaemon(dataDir, deadline, instanceManager, version)
    if (!info) return {reason: 'timeout', success: false}
    return {info, started: false, success: true}
  }

  try {
    // 4. Re-check after lock (race window between step 1 and lock acquisition)
    const recheck = discoverDaemon({dataDir, expectedVersion: version, instanceManager})
    if (recheck.running) {
      return {info: {pid: recheck.pid, port: recheck.port}, started: false, success: true}
    }

    // 5. Handle unhealthy daemon: gracefully stop when PID is alive but daemon
    //    is not healthy (version mismatch or stale heartbeat). Safe — we hold the lock.
    if (recheck.reason === 'version_mismatch' || recheck.reason === 'heartbeat_stale') {
      await gracefullyStopDaemon(recheck.pid, deadline)
    }

    // 6. Clean up stale files (safe — we hold the lock and stopped any live daemon above)
    cleanupStaleDaemonFiles(dataDir)

    // 7. Spawn daemon process
    const {getSpawnError} = spawnDaemonProcess()

    // 8. Wait for daemon to become ready (shares deadline with step 5)
    const info = await pollForDaemon(dataDir, deadline, instanceManager, version)
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
  deadline: number,
  instanceManager: IGlobalInstanceManager,
  expectedVersion?: string,
): Promise<Pick<DaemonInstanceInfo, 'pid' | 'port'> | undefined> {
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
 * Falls back to SIGKILL if the process doesn't die within the timeout
 * to prevent leaving orphaned daemon processes.
 *
 * Used when an unhealthy daemon (version mismatch or stale heartbeat)
 * needs to be stopped before spawning a replacement.
 */
async function gracefullyStopDaemon(pid: number, deadline: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process already dead — nothing to do
    return
  }

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    // eslint-disable-next-line no-await-in-loop
    await sleep(DAEMON_READY_POLL_INTERVAL_MS)
  }

  // SIGTERM didn't work — force kill to prevent two daemons running simultaneously.
  // Without this, the old daemon leaks until idle timeout (30 min) or system restart.
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Process died between last check and SIGKILL — nothing to do
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
