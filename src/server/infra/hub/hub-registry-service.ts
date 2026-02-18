import axios, {isAxiosError} from 'axios'

import type {HubEntryDTO} from '../../../shared/transport/types/dto.js'
import type {IHubRegistryService} from '../../core/interfaces/hub/i-hub-registry-service.js'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface RegistryResponse {
  count: number
  entries: HubEntryDTO[]
  generated_at: string
  version: string
}

interface CacheEntry {
  data: RegistryResponse
  expiresAt: number
}

export class HubRegistryService implements IHubRegistryService {
  private cache: CacheEntry | null = null
  private readonly registryUrl: string

  constructor(registryUrl: string) {
    this.registryUrl = registryUrl
  }

  async getEntries(): Promise<{entries: HubEntryDTO[]; version: string}> {
    const registry = await this.fetchRegistry()
    return {entries: registry.entries, version: registry.version}
  }

  async getEntryById(entryId: string): Promise<HubEntryDTO | undefined> {
    const registry = await this.fetchRegistry()
    return registry.entries.find((entry) => entry.id === entryId)
  }

  private async fetchRegistry(): Promise<RegistryResponse> {
    const cached = this.getFromCache()
    if (cached) {
      return cached
    }

    try {
      const response = await axios.get<RegistryResponse>(this.registryUrl, {
        timeout: 10_000,
      })

      this.storeInCache(response.data)
      return response.data
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new Error('Hub registry request timed out. Please check your network connection.')
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || !error.response) {
          throw new Error('Unable to reach the hub registry. Please check your network connection.')
        }

        throw new Error(`Failed to fetch hub registry: HTTP ${error.response.status}`)
      }

      throw new Error(`Failed to fetch hub registry: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private getFromCache(): RegistryResponse | undefined {
    if (!this.cache) {
      return undefined
    }

    if (Date.now() > this.cache.expiresAt) {
      this.cache = null
      return undefined
    }

    return this.cache.data
  }

  private storeInCache(data: RegistryResponse): void {
    this.cache = {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    }
  }
}
