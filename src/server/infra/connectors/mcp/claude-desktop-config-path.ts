import {existsSync} from 'node:fs'
import {homedir, platform} from 'node:os'
import {join} from 'node:path'

const CLAUDE_DESKTOP_CONFIG_FILE = 'claude_desktop_config.json'
const CLAUDE_DESKTOP_DIR = 'Claude'
// Publisher hash is derived from Anthropic's signing certificate — stable per publisher identity
const MSIX_PACKAGE_DIR = 'Claude_pzs8sxrjxfjjc'

/**
 * Dependencies for platform detection, injectable for testing.
 */
type PlatformDeps = {
  env: Record<string, string | undefined>
  existsSync?: (path: string) => boolean
  homedir: () => string
  platform: () => NodeJS.Platform
}

const defaultDeps: PlatformDeps = {
  env: process.env,
  homedir,
  platform,
}

/**
 * Returns the absolute path to the Claude Desktop config file,
 * following platform conventions:
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Windows: %APPDATA%\Claude\claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 *
 * @returns Absolute path to the Claude Desktop config file
 */
export const getClaudeDesktopConfigPath = (deps: PlatformDeps = defaultDeps): string => {
  const currentPlatform = deps.platform()

  if (currentPlatform === 'win32') {
    const checkExists = deps.existsSync ?? existsSync
    const localAppData = deps.env.LOCALAPPDATA ?? join(deps.homedir(), 'AppData', 'Local')
    const msixDir = join(localAppData, 'Packages', MSIX_PACKAGE_DIR, 'LocalCache', 'Roaming', CLAUDE_DESKTOP_DIR)
    // Check directory, not the config file — file may not exist yet on first launch
    if (checkExists(msixDir)) return join(msixDir, CLAUDE_DESKTOP_CONFIG_FILE)

    const appData = deps.env.APPDATA
    if (appData !== undefined) {
      return join(appData, CLAUDE_DESKTOP_DIR, CLAUDE_DESKTOP_CONFIG_FILE)
    }

    return join(deps.homedir(), 'AppData', 'Roaming', CLAUDE_DESKTOP_DIR, CLAUDE_DESKTOP_CONFIG_FILE)
  }

  if (currentPlatform === 'darwin') {
    return join(deps.homedir(), 'Library', 'Application Support', CLAUDE_DESKTOP_DIR, CLAUDE_DESKTOP_CONFIG_FILE)
  }

  // Linux and other platforms: respect XDG_CONFIG_HOME if set
  const xdgConfigHome = deps.env.XDG_CONFIG_HOME
  if (xdgConfigHome !== undefined) {
    return join(xdgConfigHome, CLAUDE_DESKTOP_DIR, CLAUDE_DESKTOP_CONFIG_FILE)
  }

  // Default fallback (Linux and other platforms)
  return join(deps.homedir(), '.config', CLAUDE_DESKTOP_DIR, CLAUDE_DESKTOP_CONFIG_FILE)
}
