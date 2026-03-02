import type {HubEntryDTO} from '../../../../shared/transport/types/dto.js'

/**
 * Interface for fetching hub registry entries.
 */
export interface IHubRegistryService {
  /**
   * Fetches all entries from the hub registry.
   *
   * @returns A promise resolving to the list of entries and registry version.
   */
  getEntries(): Promise<{entries: HubEntryDTO[]; version: string}>

  /**
   * Fetches ALL entries matching the given ID across all registries.
   * Used for detecting ID collisions across multiple registries.
   *
   * @param entryId The ID of the entry to find.
   * @returns A promise resolving to an array of matching entries (may be empty).
   */
  getEntriesById(entryId: string): Promise<HubEntryDTO[]>

  /**
   * Fetches a single entry by its ID.
   *
   * @param entryId The ID of the entry to find.
   * @returns A promise resolving to the entry, or undefined if not found.
   */
  getEntryById(entryId: string): Promise<HubEntryDTO | undefined>
}
