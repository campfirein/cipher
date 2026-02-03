import {homedir, platform} from 'node:os'
import {join} from 'node:path'

import {GLOBAL_DATA_DIR} from '../constants.js'

/**
 * Returns the global data directory path following XDG spec:
 * - Linux: $XDG_DATA_HOME/brv (defaults to ~/.local/share/brv)
 * - macOS: ~/.local/share/brv
 * - Windows: %LOCALAPPDATA%/brv
 *
 * Use this for user data and secrets (not config files).
 *
 * @returns Absolute path to the global data directory
 */
export const getGlobalDataDir = (): string => {
  if (process.env.BRV_DATA_DIR) return process.env.BRV_DATA_DIR

  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData !== undefined) {
      return join(localAppData, GLOBAL_DATA_DIR)
    }

    return join(homedir(), 'AppData', 'Local', GLOBAL_DATA_DIR)
  }

  // Linux: respect XDG_DATA_HOME if set
  if (currentPlatform === 'linux') {
    const xdgDataHome = process.env.XDG_DATA_HOME
    if (xdgDataHome !== undefined) {
      return join(xdgDataHome, GLOBAL_DATA_DIR)
    }
  }

  // Linux (default) and macOS: use ~/.local/share/brv
  return join(homedir(), '.local', 'share', GLOBAL_DATA_DIR)
}
