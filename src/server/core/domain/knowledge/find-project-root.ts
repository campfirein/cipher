import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../../constants.js'

export interface FindProjectRootOptions {
  /** Stop walking up at the nearest git root (.git directory). Default: false */
  stopAtGitRoot?: boolean
}

/**
 * Walks up the directory tree from `startDir` looking for `.brv/config.json`.
 * Returns the first directory that contains `.brv/config.json`, or undefined if none found.
 *
 * Behaves like git — if you're in a subfolder, uses the nearest ancestor's `.brv/`.
 */
export function findProjectRoot(startDir: string, options?: FindProjectRootOptions): string | undefined {
  let current = startDir

  while (true) {
    const configPath = join(current, BRV_DIR, PROJECT_CONFIG_FILE)
    if (existsSync(configPath)) {
      return current
    }

    // Stop at git root if requested (check AFTER .brv/ check so git root with .brv/ is found)
    if (options?.stopAtGitRoot && existsSync(join(current, '.git'))) {
      return undefined
    }

    const parent = dirname(current)
    if (parent === current) {
      // Reached filesystem root
      return undefined
    }

    current = parent
  }
}
