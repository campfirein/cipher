import type {HubEntryDTO} from '../../../shared/transport/types/dto.js'
import type {IHubRegistryService} from '../../core/interfaces/hub/i-hub-registry-service.js'

/**
 * Composite registry service that fetches entries from multiple registries in parallel.
 * Failed registries are silently skipped so one unreachable private registry
 * does not block the official registry.
 */
export class CompositeHubRegistryService implements IHubRegistryService {
  private readonly children: IHubRegistryService[]

  constructor(children: IHubRegistryService[]) {
    if (children.length === 0) {
      throw new Error('CompositeHubRegistryService requires at least one child registry')
    }

    this.children = children
  }

  async getEntries(): Promise<{entries: HubEntryDTO[]; version: string}> {
    const results = await Promise.allSettled(this.children.map((child) => child.getEntries()))

    const allEntries: HubEntryDTO[] = []
    let version = ''

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        allEntries.push(...result.value.entries)
        // Use version from the first (official) registry
        if (index === 0) {
          version = result.value.version
        }
      }
      // Rejected registries are silently skipped
    }

    return {entries: allEntries, version}
  }

  async getEntriesById(entryId: string): Promise<HubEntryDTO[]> {
    const results = await Promise.allSettled(
      this.children.map((child) => child.getEntriesById(entryId)),
    )

    const allMatches: HubEntryDTO[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allMatches.push(...result.value)
      }
    }

    return allMatches
  }

  async getEntryById(entryId: string): Promise<HubEntryDTO | undefined> {
    // Sequential search: official registry first, stop on first match
    for (const child of this.children) {
      try {
        const entry = await child.getEntryById(entryId) // eslint-disable-line no-await-in-loop
        if (entry) return entry
      } catch {
        // Skip failed registries
      }
    }

    return undefined
  }
}
