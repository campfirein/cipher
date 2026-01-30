import {existsSync, readFileSync} from 'node:fs'

let wslCached: boolean | undefined
let headlessLinuxCached: boolean | undefined

/**
 * Detect if running in WSL (Windows Subsystem for Linux) environment.
 * Checks WSL-specific environment variables first, then falls back to /proc/version.
 */
function detectWsl(): boolean {
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
    wslCached = detectWsl()
  }

  return wslCached
}

/**
 * Detect if running in a headless Linux environment where keychain is unavailable.
 *
 * Checks for:
 * - SSH session (SSH_TTY, SSH_CONNECTION)
 * - No display server (DISPLAY, WAYLAND_DISPLAY not set)
 * - No D-Bus session (required for most Linux keyrings)
 * - Running in container (/.dockerenv)
 */
function detectHeadlessLinux(): boolean {
  if (process.platform !== 'linux') {
    return false
  }

  // WSL is handled separately
  if (isWsl()) {
    return false
  }

  // SSH session
  if (process.env.SSH_TTY !== undefined || process.env.SSH_CONNECTION !== undefined) {
    return true
  }

  // No display server (X11 or Wayland)
  if (process.env.DISPLAY === undefined && process.env.WAYLAND_DISPLAY === undefined) {
    return true
  }

  // No D-Bus session (required for gnome-keyring, KWallet)
  if (process.env.DBUS_SESSION_BUS_ADDRESS === undefined) {
    return true
  }

  // Docker container
  if (existsSync('/.dockerenv')) {
    return true
  }

  return false
}

/**
 * Check if running in headless Linux environment (cached).
 * Result is cached after first call for performance.
 */
export function isHeadlessLinux(): boolean {
  if (headlessLinuxCached === undefined) {
    headlessLinuxCached = detectHeadlessLinux()
  }

  return headlessLinuxCached
}

/**
 * Determine if file-based token storage should be used.
 * Returns true for WSL or headless Linux environments where keychain is unavailable.
 */
export function shouldUseFileTokenStore(): boolean {
  return isWsl() || isHeadlessLinux()
}

/**
 * Reset cached values (for testing only).
 * @internal
 */
export function _resetCaches(): void {
  wslCached = undefined
  headlessLinuxCached = undefined
}
