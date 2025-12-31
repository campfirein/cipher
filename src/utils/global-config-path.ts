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
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData !== undefined) {
      return join(localAppData, GLOBAL_CONFIG_DIR)
    }

    return join(homedir(), 'AppData', 'Local', GLOBAL_CONFIG_DIR)
  }

  // Linux: respect XDG_DATA_HOME if set
  if (currentPlatform === 'linux') {
    const xdgDataHome = process.env.XDG_DATA_HOME
    if (xdgDataHome !== undefined) {
      return join(xdgDataHome, GLOBAL_CONFIG_DIR)
    }
  }

  // Linux (default) and macOS: use ~/.local/share/brv
  return join(homedir(), '.local', 'share', GLOBAL_CONFIG_DIR)
}
