import {readFileSync} from 'node:fs'

// =============================================================================
// WSL Detection (covers both WSL1 and WSL2)
// =============================================================================

let wslCached: boolean | undefined

/**
 * Detect if running in WSL (Windows Subsystem for Linux) environment.
 * Checks WSL-specific environment variables first, then falls back to /proc/version.
 */
function detectWSL(): boolean {
  if (process.platform !== 'linux') {
    return false
  }

  // Method 1: Check WSL-specific environment variables (most reliable)
  if (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSLENV !== undefined) {
    return true
  }

  // Method 2: Check /proc/version for microsoft/wsl patterns (fallback)
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
export function isWSL2(): boolean {
  if (wslCached === undefined) {
    wslCached = detectWSL()
  }

  return wslCached
}

/**
 * Reset WSL detection cache (for testing purposes).
 */
export function resetWSL2Cache(): void {
  wslCached = undefined
}
