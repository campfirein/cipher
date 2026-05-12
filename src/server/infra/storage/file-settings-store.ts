import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {SettingItem} from '../../core/domain/entities/settings.js'
import type {ISettingsStore} from '../../core/interfaces/storage/i-settings-store.js'

import {SETTINGS_FILE, SETTINGS_SCHEMA_VERSION} from '../../constants.js'
import {SETTINGS_REGISTRY} from '../../core/domain/entities/settings.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {SettingsValidator} from './settings-validator.js'

type SettingsFile = {
  readonly values: Record<string, number>
  readonly version: string
}

export type FileSettingsStoreOptions = {
  readonly baseDir?: string
  readonly validator?: SettingsValidator
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Persists user setting overrides to `<BRV_DATA_DIR>/settings.json` using an
 * atomic temp-file + rename write. Reads return defaults for any key that is
 * missing or invalid in the file; surfacing invalid entries (for warning
 * logs) is the daemon-startup loader's job, not this store's.
 */
export class FileSettingsStore implements ISettingsStore {
  private readonly baseDir: string
  private readonly validator: SettingsValidator

  public constructor(options: FileSettingsStoreOptions = {}) {
    this.baseDir = options.baseDir ?? getGlobalDataDir()
    this.validator = options.validator ?? new SettingsValidator()
  }

  public async get(key: string): Promise<SettingItem> {
    const descriptor = this.validator.validateKey(key)
    const overrides = await this.readOverrides()
    return {
      current: overrides[key] ?? descriptor.default,
      default: descriptor.default,
      key: descriptor.key,
      restartRequired: true,
    }
  }

  public async list(): Promise<readonly SettingItem[]> {
    const overrides = await this.readOverrides()
    return SETTINGS_REGISTRY.map((descriptor) => ({
      current: overrides[descriptor.key] ?? descriptor.default,
      default: descriptor.default,
      key: descriptor.key,
      restartRequired: true,
    }))
  }

  public async reset(key: string): Promise<void> {
    this.validator.validateKey(key)
    const raw = await this.readRawValues()
    if (!(key in raw)) return

    delete raw[key]
    const {valid} = this.validator.partition(raw)
    if (Object.keys(valid).length === 0) {
      const path = this.filePath()
      if (existsSync(path)) await unlink(path)
      return
    }

    await this.writeFile({values: valid, version: SETTINGS_SCHEMA_VERSION})
  }

  public async set(key: string, value: unknown): Promise<void> {
    const validatedValue = this.validator.validate(key, value)
    const overrides = await this.readOverrides()
    overrides[key] = validatedValue
    await this.writeFile({values: overrides, version: SETTINGS_SCHEMA_VERSION})
  }

  private filePath(): string {
    return join(this.baseDir, SETTINGS_FILE)
  }

  private async readOverrides(): Promise<Record<string, number>> {
    const raw = await this.readRawValues()
    const {valid} = this.validator.partition(raw)
    return {...valid}
  }

  private async readRawValues(): Promise<Record<string, unknown>> {
    const path = this.filePath()
    if (!existsSync(path)) return {}

    try {
      const content = await readFile(path, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (!isRecord(parsed)) return {}

      const {values} = parsed
      if (!isRecord(values)) return {}

      return {...values}
    } catch {
      return {}
    }
  }

  private async writeFile(file: SettingsFile): Promise<void> {
    await mkdir(this.baseDir, {recursive: true})
    const path = this.filePath()
    const tmpPath = `${path}.${randomUUID()}.tmp`
    await writeFile(tmpPath, JSON.stringify(file, null, 2), 'utf8')
    await rename(tmpPath, path)
  }
}
