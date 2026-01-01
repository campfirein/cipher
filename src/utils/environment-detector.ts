import {readFileSync} from 'node:fs'

let wslCached: boolean | undefined

/**
 * Detect if running in WSL (Windows Subsystem for Linux) environment.
 * Checks WSL-specific environment variables first, then falls back to /proc/version.
 */
function detectWSL(): boolean {
  if (process.platform !== 'linux') {
    return false
  }

  if (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSLENV !== undefined) {
    return true
  }

  try {
    const version = readFileSync('/proc/version', 'utf8')
    return /microsoft|wsl/i.test(version)
  } catch {
    return false
  }
}

/**
 * Check if running in WSL environment (cached).
 * Detects both WSL1 and WSL2. Result is cached after first call for performance.
 */
export function isWsl(): boolean {
  if (wslCached === undefined) {
    wslCached = detectWSL()
  }

  return wslCached
}
