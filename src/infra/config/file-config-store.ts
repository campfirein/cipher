import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IConfigStore} from '../../core/interfaces/i-config-store.js'

import {BrConfig} from '../../core/domain/entities/br-config.js'

/**
 * File-based implementation of IConfigStore.
 * Stores configuration in .br/config.json in the project directory.
 */
export class FileConfigStore implements IConfigStore {
  private static readonly BR_DIR = '.br'
  private static readonly CONFIG_FILE = 'config.json'

  public async exists(directory?: string): Promise<boolean> {
    const configPath = this.getConfigPath(directory)
    return existsSync(configPath)
  }

  public async read(directory?: string): Promise<BrConfig | undefined> {
    const configPath = this.getConfigPath(directory)

    if (!existsSync(configPath)) {
      return undefined
    }

    try {
      const content = await readFile(configPath, 'utf8')
      const json: Record<string, string> = JSON.parse(content)
      return BrConfig.fromJson(json)
    } catch (error) {
      throw new Error(`Failed to read config from ${configPath}: ${(error as Error).message}`)
    }
  }

  public async write(config: BrConfig, directory?: string): Promise<void> {
    const brDirPath = this.getBrDirPath(directory)
    const configPath = this.getConfigPath(directory)

    try {
      // Create .br directory if it doesn't exist
      await mkdir(brDirPath, {recursive: true})

      // Write config.json
      const content = JSON.stringify(config.toJson(), undefined, 2)
      await writeFile(configPath, content, 'utf8')
    } catch (error) {
      throw new Error(`Failed to write config to ${configPath}: ${(error as Error).message}`)
    }
  }

  /**
   * Gets the full path to the .br directory.
   */
  private getBrDirPath(directory?: string): string {
    const baseDir = directory ?? process.cwd()
    return join(baseDir, FileConfigStore.BR_DIR)
  }

  /**
   * Gets the full path to the config.json file.
   */
  private getConfigPath(directory?: string): string {
    return join(this.getBrDirPath(directory), FileConfigStore.CONFIG_FILE)
  }
}
