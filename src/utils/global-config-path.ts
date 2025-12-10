import {homedir, platform} from 'node:os'
import {join} from 'node:path'

import {GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE} from '../constants.js'

/**
 * Returns the global config directory path following platform conventions:
 * - Linux: $XDG_CONFIG_HOME/brv (defaults to ~/.config/brv)
 * - macOS: ~/.config/brv (CLI tool convention)
 * - Windows: %APPDATA%/brv
 *
 * @returns Absolute path to the global config directory
 */
export const getGlobalConfigDir = (): string => {
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    // Windows: use APPDATA
    const appData = process.env.APPDATA
    if (appData !== undefined) {
      return join(appData, GLOBAL_CONFIG_DIR)
    }

    // Fallback to home directory if APPDATA is not set
    return join(homedir(), 'AppData', 'Roaming', GLOBAL_CONFIG_DIR)
  }

  // Linux: respect XDG_CONFIG_HOME if set
  if (currentPlatform === 'linux') {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME
    if (xdgConfigHome !== undefined) {
      return join(xdgConfigHome, GLOBAL_CONFIG_DIR)
    }
  }

  // Linux (default) and macOS; use ~/.config/brv
  return join(homedir(), '.config', GLOBAL_CONFIG_DIR)
}

/**
 * Returns the full path to the global config file.
 *
 * @returns Absolute path to the global config file
 */
export const getGlobalConfigPath = (): string => join(getGlobalConfigDir(), GLOBAL_CONFIG_FILE)