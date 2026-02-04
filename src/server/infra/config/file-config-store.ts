import {existsSync} from 'node:fs'
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IProjectConfigStore} from '../../core/interfaces/storage/i-project-config-store.js'

import {BRV_DIR, PROJECT_CONFIG_FILE} from '../../constants.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {BrvConfigVersionError} from '../../core/domain/errors/brv-config-version-error.js'
import {getErrorMessage} from '../../utils/error-helpers.js'

/**
 * File-based implementation of IProjectConfigStore.
 * Stores configuration in .brv/config.json in the project directory.
 */
export class ProjectConfigStore implements IProjectConfigStore {
  public async exists(directory?: string): Promise<boolean> {
    const configPath = this.getConfigPath(directory)
    return existsSync(configPath)
  }

  public async getModifiedTime(directory?: string): Promise<number | undefined> {
    const configPath = this.getConfigPath(directory)

    if (!existsSync(configPath)) {
      return undefined
    }

    try {
      const stats = await stat(configPath)
      return stats.mtimeMs
    } catch {
      return undefined
    }
  }

  public async read(directory?: string): Promise<BrvConfig | undefined> {
    const configPath = this.getConfigPath(directory)

    if (!existsSync(configPath)) {
      return undefined
    }

    try {
      const content = await readFile(configPath, 'utf8')
      const json: unknown = JSON.parse(content)
      return BrvConfig.fromJson(json)
    } catch (error) {
      if (error instanceof BrvConfigVersionError) {
        throw error
      }

      throw new Error(`Failed to read config from ${configPath}: ${getErrorMessage(error)}`)
    }
  }

  public async write(config: BrvConfig, directory?: string): Promise<void> {
    const brDirPath = this.getBrvDirPath(directory)
    const configPath = this.getConfigPath(directory)

    try {
      // Create .brv directory if it doesn't exist (for config.json only)
      await mkdir(brDirPath, {recursive: true})

      // Write config.json
      const content = JSON.stringify(config.toJson(), undefined, 2)
      await writeFile(configPath, content, 'utf8')
    } catch (error) {
      throw new Error(`Failed to write config to ${configPath}: ${getErrorMessage(error)}`)
    }
  }

  /**
   * Gets the full path to the .brv directory.
   */
  private getBrvDirPath(directory?: string): string {
    const baseDir = directory ?? process.cwd()
    return join(baseDir, BRV_DIR)
  }

  /**
   * Gets the full path to the config.json file.
   */
  private getConfigPath(directory?: string): string {
    return join(this.getBrvDirPath(directory), PROJECT_CONFIG_FILE)
  }
}
