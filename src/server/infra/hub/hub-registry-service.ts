/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'
import {z} from 'zod'

import type {AuthScheme} from '../../../shared/transport/types/auth-scheme.js'
import type {HubEntryDTO} from '../../../shared/transport/types/dto.js'
import type {IHubRegistryService} from '../../core/interfaces/hub/i-hub-registry-service.js'

import {buildAuthHeaders} from './hub-auth-headers.js'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const HubEntrySchema = z.object({
  author: z.object({name: z.string(), url: z.string()}),
  category: z.string(),
  dependencies: z.array(z.string()),
  description: z.string(),
  file_tree: z.array(z.object({name: z.string(), url: z.string()})),
  id: z.string(),
  license: z.string(),
  long_description: z.string(),
  manifest_url: z.string(),
  metadata: z.object({use_cases: z.array(z.string())}),
  name: z.string(),
  path_url: z.string(),
  readme_url: z.string(),
  tags: z.array(z.string()),
  type: z.enum(['agent-skill', 'bundle']),
  version: z.string(),
})

const RegistryResponseSchema = z.object({
  entries: z.array(z.unknown()),
  version: z.string(),
})

type ValidatedRegistryResponse = {
  entries: z.infer<typeof HubEntrySchema>[]
  version: string
}

interface CacheEntry {
  data: ValidatedRegistryResponse
  expiresAt: number
}

export interface HubRegistryServiceParams {
  authScheme?: AuthScheme
  authToken?: string
  headerName?: string
  name: string
  url: string
}

export class HubRegistryService implements IHubRegistryService {
  private readonly authScheme?: AuthScheme
  private readonly authToken?: string
  private cache: CacheEntry | null = null
  private readonly headerName?: string
  private readonly registryName: string
  private readonly registryUrl: string

  constructor(params: HubRegistryServiceParams) {
    this.authScheme = params.authScheme
    this.authToken = params.authToken
    this.headerName = params.headerName
    this.registryName = params.name
    this.registryUrl = params.url
  }

  async getEntries(): Promise<{entries: HubEntryDTO[]; version: string}> {
    const registry = await this.fetchRegistry()
    const entries = registry.entries.map((entry) => ({...entry, registry: this.registryName}))
    return {entries, version: registry.version}
  }

  async getEntriesById(entryId: string): Promise<HubEntryDTO[]> {
    const entry = await this.getEntryById(entryId)
    return entry ? [entry] : []
  }

  async getEntryById(entryId: string): Promise<HubEntryDTO | undefined> {
    const registry = await this.fetchRegistry()
    const entry = registry.entries.find((e) => e.id === entryId)
    if (!entry) return undefined
    return {...entry, registry: this.registryName}
  }

  private async fetchRegistry(): Promise<ValidatedRegistryResponse> {
    if (this.cache && Date.now() <= this.cache.expiresAt) {
      return this.cache.data
    }

    try {
      const headers = buildAuthHeaders({
        authScheme: this.authScheme,
        authToken: this.authToken,
        headerName: this.headerName,
      })

      const response = await axios.get<unknown>(this.registryUrl, {
        headers,
        timeout: 45_000,
      })

      const validated = this.parseRegistryResponse(response.data)
      this.cache = {data: validated, expiresAt: Date.now() + CACHE_TTL_MS}
      return validated
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new Error(
            `Hub registry '${this.registryName}' request timed out. Please check your network connection.`,
          )
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || !error.response) {
          throw new Error(`Unable to reach hub registry '${this.registryName}'. Please check your network connection.`)
        }

        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `Hub registry '${this.registryName}' authentication failed (HTTP ${error.response.status}). Check your auth token.`,
          )
        }

        throw new Error(`Failed to fetch hub registry '${this.registryName}': HTTP ${error.response.status}`)
      }

      throw new Error(
        `Failed to fetch hub registry '${this.registryName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Validates the raw registry JSON response using Zod schemas.
   * Invalid entries are silently dropped to prevent malicious injection.
   */
  private parseRegistryResponse(data: unknown): ValidatedRegistryResponse {
    const envelope = RegistryResponseSchema.safeParse(data)
    if (!envelope.success) {
      throw new Error(`Hub registry '${this.registryName}' returned invalid data`)
    }

    const entries = envelope.data.entries
      .map((raw) => HubEntrySchema.safeParse(raw))
      .filter((r): r is z.SafeParseSuccess<z.infer<typeof HubEntrySchema>> => r.success)
      .map((r) => r.data)

    return {entries, version: envelope.data.version}
  }
}
