import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'

import type {IGlobalConfigStore} from '../../core/interfaces/i-global-config-store.js'

import {GlobalConfig} from '../../core/domain/entities/global-config.js'
import {getGlobalConfigDir, getGlobalConfigPath} from '../../utils/global-config-path.js'

/**
 * Dependencies for FileGlobalConfigStore.
 * Allows injection for testing.
 */
export interface FileGlobalConfigStoreDeps {
  readonly getConfigDir: () => string
  readonly getConfigPath: () => string
}

/**
 * Default dependencies using the real path functions.
 */
const defaultDeps: FileGlobalConfigStoreDeps = {
  getConfigDir: getGlobalConfigDir,
  getConfigPath: getGlobalConfigPath,
}

/**
 * File-based implementation of IGlobalConfigStore.
 * Stores global configuration in the user's config directory.
 */
export class FileGlobalConfigStore implements IGlobalConfigStore {
  private readonly deps: FileGlobalConfigStoreDeps

  public constructor(deps: FileGlobalConfigStoreDeps = defaultDeps) {
    this.deps = deps
  }

  public async getOrCreateDeviceId(): Promise<string> {
    // Try to read existing config
    const existingConfig = await this.read()

    if (existingConfig !== undefined) {
      return existingConfig.deviceId
    }

    // Generate new device ID and persist
    const deviceId = randomUUID()
    const newConfig = GlobalConfig.create(deviceId)
    await this.write(newConfig)

    return deviceId
  }

  public async read(): Promise<GlobalConfig | undefined> {
    const configPath = this.deps.getConfigPath()

    if (!existsSync(configPath)) {
      return undefined
    }

    try {
      const content = await readFile(configPath, 'utf8')
      const json: unknown = JSON.parse(content)
      return GlobalConfig.fromJson(json)
    } catch {
      // Return undefined for any error (corrupted file, permission issues, etc.)
      // The caller can regenerate the config if needed
      return undefined
    }
  }

  public async write(config: GlobalConfig): Promise<void> {
    const configDir = this.deps.getConfigDir()
    const configPath = this.deps.getConfigPath()

    // Create config directory if it doesn't exist
    await mkdir(configDir, {recursive: true})

    // Write config.json
    const content = JSON.stringify(config.toJson(), null, 2)
    await writeFile(configPath, content, 'utf8')
  }
}
