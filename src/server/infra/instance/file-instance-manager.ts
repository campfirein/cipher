import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {AcquireResult, IInstanceManager} from '../../core/interfaces/instance/i-instance-manager.js'

import {BRV_DIR, INSTANCE_FILE} from '../../constants.js'
import {InstanceInfo, type InstanceInfoJson} from '../../core/domain/instance/types.js'
import {getCurrentPid, isProcessAlive} from './process-utils.js'

/**
 * Type guard to validate instance.json structure.
 * Ensures all required fields exist with correct types.
 */
function isValidInstanceInfoJson(value: unknown): value is InstanceInfoJson {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.pid === 'number' &&
    typeof obj.port === 'number' &&
    typeof obj.startedAt === 'number' &&
    (obj.currentSessionId === null || typeof obj.currentSessionId === 'string')
  )
}

/**
 * File-based implementation of IInstanceManager.
 *
 * Stores instance information in .brv/instance.json.
 *
 * NOTE: We don't store "status" - we check pid alive at runtime.
 * This handles crashes gracefully without stale status.
 */
export class FileInstanceManager implements IInstanceManager {
  /**
   * Attempts to acquire an instance lock.
   *
   * Logic:
   * - No file → create new instance
   * - File exists + pid alive → already running, fail
   * - File exists + pid dead → stale (crashed), overwrite
   *
   * @param projectRoot - Root directory containing .brv/
   * @param port - Port the transport server will use
   */
  async acquire(projectRoot: string, port: number): Promise<AcquireResult> {
    const existing = await this.load(projectRoot)

    // Check if there's an existing running instance (pid alive)
    if (existing && isProcessAlive(existing.pid)) {
      return {
        acquired: false,
        existingInstance: existing,
        reason: 'already_running',
      }
    }

    // Create new instance (either no existing or stale/crashed)
    const instance = InstanceInfo.create({
      pid: getCurrentPid(),
      port,
    })

    await this.save(projectRoot, instance)

    return {
      acquired: true,
      instance,
    }
  }

  /**
   * Loads instance info from the project root.
   */
  async load(projectRoot: string): Promise<InstanceInfo | undefined> {
    const filePath = this.getInstanceFilePath(projectRoot)

    try {
      const content = await readFile(filePath, 'utf8')
      const json: unknown = JSON.parse(content)

      if (!isValidInstanceInfoJson(json)) {
        // Corrupted file = no valid instance
        return undefined
      }

      return InstanceInfo.fromJson(json)
    } catch {
      // File doesn't exist, is corrupted, or unreadable = no valid instance
      return undefined
    }
  }

  /**
   * Releases the instance lock by deleting instance.json.
   *
   * Called during graceful shutdown.
   */
  async release(projectRoot: string): Promise<void> {
    const filePath = this.getInstanceFilePath(projectRoot)

    try {
      await rm(filePath)
    } catch {
      // File might not exist, ignore
    }
  }

  /**
   * Updates the current session ID.
   */
  async updateSessionId(projectRoot: string, sessionId: string): Promise<void> {
    const instance = await this.load(projectRoot)

    if (!instance) {
      throw new Error('No instance found to update')
    }

    const updated = instance.withSessionId(sessionId)
    await this.save(projectRoot, updated)
  }

  /**
   * Gets the path to the instance.json file.
   */
  private getInstanceFilePath(projectRoot: string): string {
    return join(projectRoot, BRV_DIR, INSTANCE_FILE)
  }

  /**
   * Saves instance info to the project root.
   */
  private async save(projectRoot: string, instance: InstanceInfo): Promise<void> {
    const brvDir = join(projectRoot, BRV_DIR)
    const filePath = this.getInstanceFilePath(projectRoot)

    // Ensure .brv directory exists
    await mkdir(brvDir, {recursive: true})

    // Write instance.json with pretty formatting
    const json = JSON.stringify(instance.toJson(), null, 2)
    await writeFile(filePath, json, 'utf8')
  }
}
