import {access} from 'node:fs/promises'
import {dirname, join, parse} from 'node:path'

import type {DiscoveryResult, IInstanceDiscovery} from '../../core/interfaces/instance/i-instance-discovery.js'
import type {IInstanceManager} from '../../core/interfaces/instance/i-instance-manager.js'

import {BRV_DIR} from '../../constants.js'
import {FileInstanceManager} from './file-instance-manager.js'
import {isProcessAlive} from './process-utils.js'

/**
 * File-based implementation of IInstanceDiscovery.
 *
 * Implements walk-up directory tree algorithm to find running instances.
 */
export class FileInstanceDiscovery implements IInstanceDiscovery {
  private readonly instanceManager: IInstanceManager

  constructor(instanceManager?: IInstanceManager) {
    this.instanceManager = instanceManager ?? new FileInstanceManager()
  }

  /**
   * Discovers a running instance starting from the given directory.
   *
   * Walk-up algorithm:
   * 1. Start from `fromDir`
   * 2. Check if .brv/instance.json exists
   * 3. If yes, verify pid is alive
   * 4. If no, walk up to parent directory
   * 5. Repeat until root or found
   */
  async discover(fromDir: string): Promise<DiscoveryResult> {
    const projectRoot = await this.findProjectRoot(fromDir)

    if (!projectRoot) {
      return {found: false, reason: 'no_instance'}
    }

    const instance = await this.instanceManager.load(projectRoot)

    if (!instance) {
      return {found: false, reason: 'no_instance'}
    }

    // Verify PID is alive (this is the only check we need)
    if (!isProcessAlive(instance.pid)) {
      return {found: false, reason: 'instance_crashed'}
    }

    return {
      found: true,
      instance,
      projectRoot,
    }
  }

  /**
   * Finds the project root by walking up from a directory.
   * Returns the directory containing .brv/ or undefined if not found.
   */
  async findProjectRoot(fromDir: string): Promise<string | undefined> {
    let currentDir = fromDir

    // Walk up requires sequential checks - can't parallelize tree traversal
    while (true) {
      const brvPath = join(currentDir, BRV_DIR)

      // eslint-disable-next-line no-await-in-loop
      if (await this.directoryExists(brvPath)) {
        return currentDir
      }

      // Get parent directory
      const parentDir = dirname(currentDir)

      // Check if we've reached the root
      if (parentDir === currentDir) {
        return undefined
      }

      // Check if we've reached filesystem root (e.g., "/" or "C:\")
      const parsed = parse(currentDir)
      if (parsed.root === currentDir) {
        return undefined
      }

      currentDir = parentDir
    }
  }

  /**
   * Checks if a directory exists.
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }
}
