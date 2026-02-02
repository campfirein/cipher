import {join} from 'node:path'

import type {IGlobalInstanceManager} from '../../core/interfaces/daemon/i-global-instance-manager.js'

import {HEARTBEAT_FILE} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {isProcessAlive} from '../instance/process-utils.js'
import {GlobalInstanceManager} from './global-instance-manager.js'
import {isHeartbeatStale} from './heartbeat.js'

export type DaemonStatus =
  | {actualVersion: string; expectedVersion: string; pid: number; reason: 'version_mismatch'; running: false}
  | {pid: number; port: number; running: true}
  | {pid: number; reason: 'heartbeat_stale' | 'pid_dead'; running: false}
  | {reason: 'no_instance'; running: false}

/**
 * Checks whether the global daemon is running and healthy.
 *
 * Health checks (all must pass):
 * 1. daemon.json exists at ~/.local/share/brv/ and is valid
 * 2. PID is alive
 * 3. Heartbeat is fresh (<15s)
 * 4. Version matches expectedVersion (if provided)
 *
 * @param options - Discovery options.
 * @param options.dataDir - Custom data directory (defaults to global).
 * @param options.expectedVersion - If provided, daemon version must match.
 *   A mismatch returns `{running: false, reason: 'version_mismatch', pid}`.
 * @param options.instanceManager - Injectable for testing and caller reuse.
 *   Defaults to a new GlobalInstanceManager if not provided.
 */
export function discoverDaemon(options?: {
  dataDir?: string
  expectedVersion?: string
  instanceManager?: IGlobalInstanceManager
}): DaemonStatus {
  const dataDir = options?.dataDir ?? getGlobalDataDir()

  const instanceManager = options?.instanceManager ?? new GlobalInstanceManager({dataDir})
  const instance = instanceManager.load()

  if (!instance) {
    return {reason: 'no_instance', running: false}
  }

  if (!isProcessAlive(instance.pid)) {
    return {pid: instance.pid, reason: 'pid_dead', running: false}
  }

  const heartbeatPath = join(dataDir, HEARTBEAT_FILE)
  if (isHeartbeatStale(heartbeatPath)) {
    return {pid: instance.pid, reason: 'heartbeat_stale', running: false}
  }

  if (options?.expectedVersion && instance.version !== options.expectedVersion) {
    return {
      actualVersion: instance.version,
      expectedVersion: options.expectedVersion,
      pid: instance.pid,
      reason: 'version_mismatch',
      running: false,
    }
  }

  return {pid: instance.pid, port: instance.port, running: true}
}
