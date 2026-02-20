import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {
  HubRegistryEntry,
  IHubRegistryConfigStore,
} from '../../core/interfaces/hub/i-hub-registry-config-store.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'

const REGISTRIES_FILE = 'hub-registries.json'

/**
 * Dependencies for HubRegistryConfigStore.
 * Allows injection for testing.
 */
export interface HubRegistryConfigStoreDeps {
  readonly getDataDir: () => string
  readonly getFilePath: () => string
}

const defaultDeps: HubRegistryConfigStoreDeps = {
  getDataDir: getGlobalDataDir,
  getFilePath: () => join(getGlobalDataDir(), REGISTRIES_FILE),
}

const VALID_AUTH_SCHEMES = new Set(['basic', 'bearer', 'custom-header', 'none', 'token'])

const isRegistryEntry = (value: unknown): value is HubRegistryEntry => {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.name !== 'string' || obj.name.length === 0) return false
  if (typeof obj.url !== 'string' || obj.url.length === 0) return false
  if (obj.authScheme !== undefined && !VALID_AUTH_SCHEMES.has(obj.authScheme as string)) return false
  if (obj.headerName !== undefined && typeof obj.headerName !== 'string') return false
  return true
}

/**
 * File-based store for private hub registry configurations.
 * Stores a JSON array of {name, url} objects in the global data directory.
 */
export class HubRegistryConfigStore implements IHubRegistryConfigStore {
  private cache: HubRegistryEntry[] | null = null
  private readonly deps: HubRegistryConfigStoreDeps

  constructor(deps: HubRegistryConfigStoreDeps = defaultDeps) {
    this.deps = deps
  }

  async addRegistry(entry: HubRegistryEntry): Promise<void> {
    const registries = await this.loadRegistries()
    if (registries.some((r) => r.name === entry.name)) {
      throw new Error(`Registry '${entry.name}' already exists`)
    }

    const toStore: HubRegistryEntry = {
      ...(entry.authScheme ? {authScheme: entry.authScheme} : {}),
      ...(entry.headerName ? {headerName: entry.headerName} : {}),
      name: entry.name,
      url: entry.url,
    }

    registries.push(toStore)
    await this.saveRegistries(registries)
  }

  clearCache(): void {
    this.cache = null
  }

  async getRegistries(): Promise<HubRegistryEntry[]> {
    return this.loadRegistries()
  }

  async removeRegistry(name: string): Promise<void> {
    const registries = await this.loadRegistries()
    const filtered = registries.filter((r) => r.name !== name)
    await this.saveRegistries(filtered)
  }

  private async loadRegistries(): Promise<HubRegistryEntry[]> {
    if (this.cache) {
      return [...this.cache]
    }

    const filePath = this.deps.getFilePath()
    if (!existsSync(filePath)) {
      this.cache = []
      return []
    }

    try {
      const content = await readFile(filePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (!Array.isArray(parsed)) {
        this.cache = []
        return []
      }

      const registries = parsed.filter((entry) => isRegistryEntry(entry))
      this.cache = registries
      return [...registries]
    } catch {
      this.cache = []
      return []
    }
  }

  private async saveRegistries(registries: HubRegistryEntry[]): Promise<void> {
    const dataDir = this.deps.getDataDir()
    const filePath = this.deps.getFilePath()

    await mkdir(dataDir, {recursive: true})
    await writeFile(filePath, JSON.stringify(registries, null, 2), 'utf8')
    this.cache = [...registries]
  }
}
