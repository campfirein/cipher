import {readFileSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {WEBUI_STATE_FILE} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'

const WEBUI_CONFIG_FILE = 'webui-config.json'

interface WebuiState {
  port: number
}

// === Runtime state (deleted on shutdown) ===

/**
 * Writes the web UI port to a state file in the global data directory.
 * Used by `brv webui` to discover the stable port.
 */
export function writeWebuiState(port: number, dir?: string): void {
  const filePath = join(dir ?? getGlobalDataDir(), WEBUI_STATE_FILE)
  writeFileSync(filePath, JSON.stringify({port}), 'utf8')
}

/**
 * Reads the web UI port from the state file.
 * Returns undefined if the file is missing, corrupt, or has an invalid structure.
 */
export function readWebuiState(dir?: string): undefined | WebuiState {
  const filePath = join(dir ?? getGlobalDataDir(), WEBUI_STATE_FILE)
  try {
    const content = readFileSync(filePath, 'utf8')
    const json: unknown = JSON.parse(content)
    if (typeof json !== 'object' || json === null) return undefined
    const obj = json as Record<string, unknown>
    if (typeof obj.port !== 'number') return undefined
    return {port: obj.port}
  } catch {
    return undefined
  }
}

/**
 * Removes the web UI state file. Best-effort — does not throw.
 */
export function removeWebuiState(dir?: string): void {
  const filePath = join(dir ?? getGlobalDataDir(), WEBUI_STATE_FILE)
  try {
    unlinkSync(filePath)
  } catch {
    // Best-effort
  }
}

// === Persistent config (survives daemon restarts) ===

/**
 * Saves the user's preferred webui port. Persists across daemon restarts.
 */
export function writeWebuiPreferredPort(port: number, dir?: string): void {
  const filePath = join(dir ?? getGlobalDataDir(), WEBUI_CONFIG_FILE)
  writeFileSync(filePath, JSON.stringify({port}), 'utf8')
}

/**
 * Reads the user's preferred webui port.
 * Returns undefined if not configured.
 */
export function readWebuiPreferredPort(dir?: string): number | undefined {
  const filePath = join(dir ?? getGlobalDataDir(), WEBUI_CONFIG_FILE)
  try {
    const content = readFileSync(filePath, 'utf8')
    const json: unknown = JSON.parse(content)
    if (typeof json !== 'object' || json === null) return undefined
    const obj = json as Record<string, unknown>
    if (typeof obj.port !== 'number') return undefined
    return obj.port
  } catch {
    return undefined
  }
}
