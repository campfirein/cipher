import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {BrvConfig} from '../core/domain/entities/brv-config.js'

import {PROJECT_CONFIG_FILE} from '../constants.js'
import {getProjectDataDir} from './path-utils.js'

/**
 * Clones a BrvConfig to the XDG project data directory.
 * IDE plugins read the XDG path to discover project configs
 * without needing to be inside the project directory.
 *
 * Best-effort: failures are silently ignored since XDG sync
 * is a convenience feature that should never block the caller.
 *
 * @param config - The config to persist
 * @param projectPath - The project's working directory (used to derive XDG path)
 */
export async function syncConfigToXdg(config: BrvConfig, projectPath: string): Promise<void> {
  try {
    const xdgDir = getProjectDataDir(projectPath)
    await mkdir(xdgDir, {recursive: true})
    await writeFile(join(xdgDir, PROJECT_CONFIG_FILE), JSON.stringify(config.toJson(), undefined, 2), 'utf8')
  } catch {
    // Best-effort — XDG sync failure should not block the caller
  }
}
