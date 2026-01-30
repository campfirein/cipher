import {homedir, platform, tmpdir} from 'node:os'
import {join} from 'node:path'

/**
 * Returns the global logs directory path following platform conventions:
 * - Windows: %LOCALAPPDATA%/brv/logs
 * - macOS: ~/Library/Logs/brv
 * - Linux: $XDG_STATE_HOME/brv/logs (defaults to ~/.local/state/brv/logs)
 *
 * Falls back to temp directory if any system call fails.
 *
 * @returns Absolute path to the global logs directory
 */
export function getGlobalLogsDir(): string {
  try {
    const currentPlatform = platform()

    if (currentPlatform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA
      if (localAppData) {
        return join(localAppData, 'brv', 'logs')
      }

      return join(homedir(), 'AppData', 'Local', 'brv', 'logs')
    }

    if (currentPlatform === 'darwin') {
      return join(homedir(), 'Library', 'Logs', 'brv')
    }

    // Linux: XDG_STATE_HOME/brv/logs
    const xdgStateHome = process.env.XDG_STATE_HOME
    if (xdgStateHome) {
      return join(xdgStateHome, 'brv', 'logs')
    }

    return join(homedir(), '.local', 'state', 'brv', 'logs')
  } catch {
    // Fallback to temp directory if any system call fails
    return join(tmpdir(), 'brv', 'logs')
  }
}
