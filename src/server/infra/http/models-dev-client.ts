/**
 * Models.dev Client
 *
 * Fetches model metadata from https://models.dev/api.json — a centralized
 * third-party model database. Caches to disk with 60-minute TTL.
 * Used by OpenAIModelFetcher to get dynamic Codex model lists for OAuth.
 */

import axios from 'axios'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {z} from 'zod'

import type {ProviderModelInfo} from '../../core/interfaces/i-provider-model-fetcher.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {ProxyConfig} from './proxy-config.js'

// ============================================================================
// Schemas
// ============================================================================

interface ModelsDevModel {
  cost?: {
    cache_read?: number
    input: number
    output: number
  }
  id: string
  limit: {
    context: number
    input?: number
    output?: number
  }
  name: string
}

interface ModelsDevProvider {
  models: Record<string, ModelsDevModel>
  name: string
}

type ModelsDevData = Record<string, ModelsDevProvider>

const CacheEnvelopeSchema = z.object({
  data: z.record(z.unknown()),
  timestamp: z.number(),
})

interface CacheEnvelope {
  data: ModelsDevData
  timestamp: number
}

// ============================================================================
// Constants
// ============================================================================

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 60 * 60 * 1000 // 60 minutes
const FETCH_TIMEOUT_MS = 10_000

// ============================================================================
// Client
// ============================================================================

export class ModelsDevClient {
  private readonly cachePath: string
  private inMemoryCache: CacheEnvelope | undefined

  constructor(cachePath?: string) {
    this.cachePath = cachePath ?? join(getGlobalDataDir(), 'models-dev.json')
  }

  /**
   * Get models for a specific provider, transformed to ProviderModelInfo[].
   */
  async getModelsForProvider(providerId: string, forceRefresh = false): Promise<ProviderModelInfo[]> {
    const data = await this.getData(forceRefresh)
    const provider = data[providerId]
    if (!provider) return []

    return Object.values(provider.models).map((model) => ({
      contextLength: model.limit.context,
      id: model.id,
      isFree: !model.cost,
      name: model.name,
      pricing: {
        inputPerM: model.cost?.input ?? 0,
        outputPerM: model.cost?.output ?? 0,
      },
      provider: provider.name,
    }))
  }

  /**
   * Force refresh the cache from models.dev.
   */
  async refresh(): Promise<void> {
    await this.fetchAndCache()
  }

  private async fetchAndCache(): Promise<ModelsDevData> {
    const response = await axios.get<ModelsDevData>(MODELS_DEV_URL, {
      httpAgent: ProxyConfig.getProxyAgent(),
      httpsAgent: ProxyConfig.getProxyAgent(),
      proxy: false,
      timeout: FETCH_TIMEOUT_MS,
    })

    const {data} = response
    const envelope: CacheEnvelope = {data, timestamp: Date.now()}

    this.inMemoryCache = envelope

    // Write to disk (best-effort, don't throw on failure)
    try {
      await mkdir(dirname(this.cachePath), {recursive: true})
      await writeFile(this.cachePath, JSON.stringify(envelope), 'utf8')
    } catch {
      // Cache write failure is non-fatal
    }

    return data
  }

  private async getData(forceRefresh: boolean): Promise<ModelsDevData> {
    // Check in-memory cache
    if (!forceRefresh && this.inMemoryCache && Date.now() - this.inMemoryCache.timestamp < CACHE_TTL_MS) {
      return this.inMemoryCache.data
    }

    // Try disk cache
    if (!forceRefresh) {
      const diskCache = await this.readDiskCache()
      if (diskCache && Date.now() - diskCache.timestamp < CACHE_TTL_MS) {
        this.inMemoryCache = diskCache
        return diskCache.data
      }
    }

    // Fetch from network
    try {
      return await this.fetchAndCache()
    } catch {
      // Network failure: fall back to stale disk cache (any age)
      const staleCache = this.inMemoryCache ?? (await this.readDiskCache())
      if (staleCache) {
        this.inMemoryCache = staleCache
        return staleCache.data
      }

      // No cache at all — return empty
      return {}
    }
  }

  private async readDiskCache(): Promise<CacheEnvelope | undefined> {
    try {
      const content = await readFile(this.cachePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      const result = CacheEnvelopeSchema.safeParse(parsed)
      if (result.success) {
        return result.data as CacheEnvelope
      }
    } catch {
      // Cache read failure is non-fatal
    }

    return undefined
  }
}

/**
 * Singleton instance for the models.dev client.
 */
let clientInstance: ModelsDevClient | undefined

export function getModelsDevClient(): ModelsDevClient {
  if (!clientInstance) {
    clientInstance = new ModelsDevClient()
  }

  return clientInstance
}

/**
 * Reset the singleton (for testing).
 */
export function resetModelsDevClient(): void {
  clientInstance = undefined
}
